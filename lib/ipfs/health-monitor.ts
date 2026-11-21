import { prisma } from '@/lib/prisma';
import {
  raceGateways,
  defaultGatewayHealthTracker,
  type GatewayHealthTracker,
} from './gateways';
import { getPinners, type IpfsPinner } from './pinner';

/**
 * Periodic IPFS pin health monitoring and automatic re-pinning (#1769).
 *
 * Verifies both provider-level pin status (`hasPin`) and real gateway
 * retrievability (with CID + SHA-256 verification). Whenever a provider has
 * dropped content or total healthy replicas fall below `targetRedundancy`,
 * verified bytes are fetched from surviving replicas/gateways and re-pinned.
 */

export type ReplicaStatus = 'PINNED' | 'DEGRADED' | 'FAILED' | 'REPINNING';

export interface TrackedPin {
  cid: string;
  sha256: string;
  size: number;
  name?: string;
}

export interface PinReplicaRecord {
  cid: string;
  provider: string;
  providerPinId?: string | null;
  status: ReplicaStatus;
  lastCheckedAt: Date | null;
  lastHealthyAt: Date | null;
  consecutiveFailures: number;
  lastLatencyMs: number | null;
  lastError: string | null;
}

export interface PinHealthStore {
  listPins(limit: number): Promise<TrackedPin[]>;
  listReplicas(cid?: string, limit?: number): Promise<PinReplicaRecord[]>;
  upsertReplica(record: PinReplicaRecord): Promise<void>;
}

/** Prisma-backed replica store for production/staging deployments. */
export class PrismaPinHealthStore implements PinHealthStore {
  async listPins(limit: number): Promise<TrackedPin[]> {
    const rows = await prisma.pinnedFile.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { cid: true, sha256: true, size: true },
    });
    return rows;
  }

  async listReplicas(cid?: string, limit = 100): Promise<PinReplicaRecord[]> {
    const rows = await prisma.ipfsPinReplica.findMany({
      where: cid ? { cid } : undefined,
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => ({
      cid: r.cid,
      provider: r.provider,
      providerPinId: r.providerPinId,
      status: r.status as ReplicaStatus,
      lastCheckedAt: r.lastCheckedAt,
      lastHealthyAt: r.lastHealthyAt,
      consecutiveFailures: r.consecutiveFailures,
      lastLatencyMs: r.lastLatencyMs,
      lastError: r.lastError,
    }));
  }

  async upsertReplica(record: PinReplicaRecord): Promise<void> {
    await prisma.ipfsPinReplica.upsert({
      where: { cid_provider: { cid: record.cid, provider: record.provider } },
      update: {
        providerPinId: record.providerPinId ?? undefined,
        status: record.status,
        lastCheckedAt: record.lastCheckedAt,
        lastHealthyAt: record.lastHealthyAt ?? undefined,
        consecutiveFailures: record.consecutiveFailures,
        lastLatencyMs: record.lastLatencyMs,
        lastError: record.lastError,
      },
      create: {
        cid: record.cid,
        provider: record.provider,
        providerPinId: record.providerPinId ?? null,
        status: record.status,
        lastCheckedAt: record.lastCheckedAt,
        lastHealthyAt: record.lastHealthyAt,
        consecutiveFailures: record.consecutiveFailures,
        lastLatencyMs: record.lastLatencyMs,
        lastError: record.lastError,
      },
    });
  }
}

/** In-memory store for unit tests and local dry-runs. */
export class InMemoryPinHealthStore implements PinHealthStore {
  private readonly pins = new Map<string, TrackedPin>();
  private readonly replicas = new Map<string, PinReplicaRecord>();

  constructor(initialPins: TrackedPin[] = [], initialReplicas: PinReplicaRecord[] = []) {
    for (const p of initialPins) this.pins.set(p.cid, p);
    for (const r of initialReplicas) this.replicas.set(`${r.cid}:${r.provider}`, r);
  }

  addPin(pin: TrackedPin): void {
    this.pins.set(pin.cid, pin);
  }

  async listPins(limit: number): Promise<TrackedPin[]> {
    return Array.from(this.pins.values()).slice(0, limit);
  }

  async listReplicas(cid?: string, limit = 100): Promise<PinReplicaRecord[]> {
    const all = Array.from(this.replicas.values());
    const filtered = cid ? all.filter((r) => r.cid === cid) : all;
    return filtered.slice(0, limit);
  }

  async upsertReplica(record: PinReplicaRecord): Promise<void> {
    this.replicas.set(`${record.cid}:${record.provider}`, record);
  }
}

export interface PinHealthCheckOptions {
  targetRedundancy?: number;
  timeoutMs?: number;
  gateways?: readonly string[];
  healthTracker?: GatewayHealthTracker;
  store?: PinHealthStore;
  verifyCid?: boolean;
}

export interface PinHealthReport {
  cid: string;
  status: 'healthy' | 'repaired' | 'degraded' | 'unreachable';
  retrievable: boolean;
  gatewayUsed?: string;
  latencyMs?: number;
  healthyProviders: string[];
  failedProviders: string[];
  repinnedProviders: string[];
  errors: string[];
}

/**
 * Check a single pin's retrievability and provider redundancy, automatically
 * re-pinning verified bytes onto any provider that dropped the content.
 */
export async function checkAndRepairPin(
  pin: TrackedPin,
  providers: IpfsPinner[],
  options: PinHealthCheckOptions = {},
): Promise<PinHealthReport> {
  const targetRedundancy = Math.max(1, options.targetRedundancy ?? 2);
  const now = new Date();
  const errors: string[] = [];

  const existingReplicas = options.store ? await options.store.listReplicas(pin.cid) : [];
  const existingByProvider = new Map(existingReplicas.map((r) => [r.provider, r]));

  // 1. Check retrievability via gateway racing with cryptographic verification
  let retrievedBlob: Blob | null = null;
  let gatewayUsed: string | undefined;
  let retrievalLatencyMs: number | undefined;

  try {
    const fetched = await raceGateways(pin.cid, {
      verifyHash: pin.sha256,
      verifyCid: options.verifyCid ?? true,
      timeoutMs: options.timeoutMs,
      gateways: options.gateways,
      healthTracker: options.healthTracker ?? defaultGatewayHealthTracker,
    });
    retrievedBlob = fetched.blob;
    gatewayUsed = fetched.gateway;
    retrievalLatencyMs = fetched.latencyMs;
  } catch (err) {
    errors.push(`Gateway retrievability failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 2. Check every configured provider's pin status
  const healthyProviders: string[] = [];
  const missingProviders: IpfsPinner[] = [];

  await Promise.all(
    providers.map(async (provider) => {
      const startedAt = Date.now();
      const prev = existingByProvider.get(provider.name);

      try {
        const pinned = provider.hasPin ? await provider.hasPin(pin.cid) : Boolean(retrievedBlob);
        const latencyMs = Date.now() - startedAt;

        if (pinned) {
          healthyProviders.push(provider.name);
          await options.store?.upsertReplica({
            cid: pin.cid,
            provider: provider.name,
            providerPinId: prev?.providerPinId ?? null,
            status: 'PINNED',
            lastCheckedAt: now,
            lastHealthyAt: now,
            consecutiveFailures: 0,
            lastLatencyMs: latencyMs,
            lastError: null,
          });
        } else {
          missingProviders.push(provider);
          await options.store?.upsertReplica({
            cid: pin.cid,
            provider: provider.name,
            providerPinId: prev?.providerPinId ?? null,
            status: 'DEGRADED',
            lastCheckedAt: now,
            lastHealthyAt: prev?.lastHealthyAt ?? null,
            consecutiveFailures: (prev?.consecutiveFailures ?? 0) + 1,
            lastLatencyMs: latencyMs,
            lastError: 'Pin missing on provider',
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`Provider ${provider.name} check failed: ${message}`);
        missingProviders.push(provider);
        await options.store?.upsertReplica({
          cid: pin.cid,
          provider: provider.name,
          providerPinId: prev?.providerPinId ?? null,
          status: 'FAILED',
          lastCheckedAt: now,
          lastHealthyAt: prev?.lastHealthyAt ?? null,
          consecutiveFailures: (prev?.consecutiveFailures ?? 0) + 1,
          lastLatencyMs: Date.now() - startedAt,
          lastError: message,
        });
      }
    }),
  );

  // 3. Re-pin onto dropped/missing providers whenever content is retrievable
  const repinnedProviders: string[] = [];
  const failedProviders: string[] = [];

  if (missingProviders.length > 0 && retrievedBlob) {
    for (const provider of missingProviders) {
      const startedAt = Date.now();
      const prev = existingByProvider.get(provider.name);
      try {
        const res = provider.pin
          ? await provider.pin(retrievedBlob, pin.name ?? `repin-${pin.cid.slice(0, 12)}`)
          : await provider.pinByCid!(pin.cid, pin.name);

        repinnedProviders.push(provider.name);
        healthyProviders.push(provider.name);
        await options.store?.upsertReplica({
          cid: pin.cid,
          provider: provider.name,
          providerPinId: res.providerPinId ?? prev?.providerPinId ?? null,
          status: 'PINNED',
          lastCheckedAt: now,
          lastHealthyAt: now,
          consecutiveFailures: 0,
          lastLatencyMs: Date.now() - startedAt,
          lastError: null,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`Re-pin on ${provider.name} failed: ${message}`);
        failedProviders.push(provider.name);
        await options.store?.upsertReplica({
          cid: pin.cid,
          provider: provider.name,
          providerPinId: prev?.providerPinId ?? null,
          status: 'FAILED',
          lastCheckedAt: now,
          lastHealthyAt: prev?.lastHealthyAt ?? null,
          consecutiveFailures: (prev?.consecutiveFailures ?? 0) + 1,
          lastLatencyMs: Date.now() - startedAt,
          lastError: `Re-pin failed: ${message}`,
        });
      }
    }
  } else if (missingProviders.length > 0) {
    for (const provider of missingProviders) {
      failedProviders.push(provider.name);
    }
  }

  let status: PinHealthReport['status'];
  if (!retrievedBlob && healthyProviders.length === 0) {
    status = 'unreachable';
  } else if (repinnedProviders.length > 0 && healthyProviders.length >= Math.min(targetRedundancy, providers.length)) {
    status = 'repaired';
  } else if (
    retrievedBlob &&
    failedProviders.length === 0 &&
    healthyProviders.length >= Math.min(targetRedundancy, providers.length)
  ) {
    status = 'healthy';
  } else {
    status = 'degraded';
  }

  return {
    cid: pin.cid,
    status,
    retrievable: Boolean(retrievedBlob),
    gatewayUsed,
    latencyMs: retrievalLatencyMs,
    healthyProviders,
    failedProviders,
    repinnedProviders,
    errors,
  };
}

export interface PinHealthSweepOptions extends PinHealthCheckOptions {
  limit?: number;
  concurrency?: number;
  providers?: IpfsPinner[];
}

export interface PinHealthSweepSummary {
  checkedAt: string;
  totalChecked: number;
  healthy: number;
  repaired: number;
  degraded: number;
  unreachable: number;
  repinnedCount: number;
  reports: PinHealthReport[];
}

/**
 * Execute a bounded-concurrency health sweep across tracked pinned files.
 */
export async function runPinHealthSweep(
  options: PinHealthSweepOptions = {},
): Promise<PinHealthSweepSummary> {
  const store = options.store ?? new PrismaPinHealthStore();
  const providers = options.providers ?? getPinners();
  const limit = Math.min(Math.max(1, options.limit ?? 50), 500);
  const concurrency = Math.min(Math.max(1, options.concurrency ?? 4), 16);

  const pins = await store.listPins(limit);
  const reports: PinHealthReport[] = [];

  for (let i = 0; i < pins.length; i += concurrency) {
    const batch = pins.slice(i, i + concurrency);
    const batchReports = await Promise.all(
      batch.map((pin) =>
        checkAndRepairPin(pin, providers, {
          ...options,
          store,
        }),
      ),
    );
    reports.push(...batchReports);
  }

  return {
    checkedAt: new Date().toISOString(),
    totalChecked: reports.length,
    healthy: reports.filter((r) => r.status === 'healthy').length,
    repaired: reports.filter((r) => r.status === 'repaired').length,
    degraded: reports.filter((r) => r.status === 'degraded').length,
    unreachable: reports.filter((r) => r.status === 'unreachable').length,
    repinnedCount: reports.reduce((sum, r) => sum + r.repinnedProviders.length, 0),
    reports,
  };
}
