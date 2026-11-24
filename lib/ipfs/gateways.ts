import { isValidCid, verifyCidContent } from './cid-verify';

export { computeRawCidV1, isValidCid, parseCid, verifyCidContent } from './cid-verify';
export type { CidVerificationResult, ParsedCid } from './cid-verify';

/** Ordered IPFS gateway endpoints — primary first, fallbacks on failure. */
export const IPFS_GATEWAYS = [
  process.env.NEXT_PUBLIC_IPFS_GATEWAY ?? 'https://ipfs.io/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://dweb.link/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
  'https://4everland.io/ipfs/',
] as const;

const DEFAULT_GATEWAY_TIMEOUT_MS = 8_000;
const GATEWAY_COOLDOWN_MS = 60_000;

export interface GatewayHealthSnapshot {
  gateway: string;
  successes: number;
  failures: number;
  consecutiveFailures: number;
  ewmaLatencyMs: number | null;
  healthy: boolean;
  cooldownUntil: number | null;
}

/**
 * Lightweight EWMA latency & failure tracker used to deprioritize slow or
 * unhealthy IPFS gateways during gateway racing and fallbacks (#1769).
 */
export class GatewayHealthTracker {
  private readonly stats = new Map<
    string,
    {
      successes: number;
      failures: number;
      consecutiveFailures: number;
      ewmaLatencyMs: number | null;
      cooldownUntil: number | null;
    }
  >();

  private getOrInit(gateway: string) {
    let entry = this.stats.get(gateway);
    if (!entry) {
      entry = {
        successes: 0,
        failures: 0,
        consecutiveFailures: 0,
        ewmaLatencyMs: null,
        cooldownUntil: null,
      };
      this.stats.set(gateway, entry);
    }
    return entry;
  }

  recordSuccess(gateway: string, latencyMs: number): void {
    const entry = this.getOrInit(gateway);
    entry.successes += 1;
    entry.consecutiveFailures = 0;
    entry.cooldownUntil = null;
    entry.ewmaLatencyMs =
      entry.ewmaLatencyMs === null
        ? latencyMs
        : Math.round(entry.ewmaLatencyMs * 0.7 + latencyMs * 0.3);
  }

  recordFailure(gateway: string, now = Date.now()): void {
    const entry = this.getOrInit(gateway);
    entry.failures += 1;
    entry.consecutiveFailures += 1;
    if (entry.consecutiveFailures >= 2) {
      entry.cooldownUntil = now + GATEWAY_COOLDOWN_MS;
    }
  }

  /**
   * Sort gateways: healthy gateways first (ordered by lowest EWMA latency),
   * cooled-down gateways last so they are still tried if every healthy gateway fails.
   */
  rankGateways(gateways: readonly string[], now = Date.now()): string[] {
    return [...gateways].sort((a, b) => {
      const sa = this.stats.get(a);
      const sb = this.stats.get(b);
      const aCooling = sa?.cooldownUntil !== null && sa?.cooldownUntil !== undefined && sa.cooldownUntil > now;
      const bCooling = sb?.cooldownUntil !== null && sb?.cooldownUntil !== undefined && sb.cooldownUntil > now;
      if (aCooling !== bCooling) return aCooling ? 1 : -1;

      const latA = sa?.ewmaLatencyMs ?? Number.POSITIVE_INFINITY;
      const latB = sb?.ewmaLatencyMs ?? Number.POSITIVE_INFINITY;
      if (latA !== latB) return latA - latB;
      return 0;
    });
  }

  getSnapshot(gateways: readonly string[] = IPFS_GATEWAYS, now = Date.now()): GatewayHealthSnapshot[] {
    return gateways.map((gateway) => {
      const entry = this.stats.get(gateway);
      const cooling = Boolean(entry?.cooldownUntil && entry.cooldownUntil > now);
      return {
        gateway,
        successes: entry?.successes ?? 0,
        failures: entry?.failures ?? 0,
        consecutiveFailures: entry?.consecutiveFailures ?? 0,
        ewmaLatencyMs: entry?.ewmaLatencyMs ?? null,
        healthy: !cooling && (entry?.consecutiveFailures ?? 0) < 2,
        cooldownUntil: cooling ? entry?.cooldownUntil ?? null : null,
      };
    });
  }

  reset(): void {
    this.stats.clear();
  }
}

export const defaultGatewayHealthTracker = new GatewayHealthTracker();

function configuredGatewayTimeoutMs(): number {
  const raw = Number(process.env.IPFS_GATEWAY_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_GATEWAY_TIMEOUT_MS;
}

export function buildGatewayUrl(cid: string, gatewayIndex = 0): string {
  const base = IPFS_GATEWAYS[gatewayIndex] ?? IPFS_GATEWAYS[0];
  const normalized = base.endsWith('/') ? base : `${base}/`;
  return `${normalized}${cid}`;
}

export function buildGatewayUrlFromBase(base: string, cid: string): string {
  const normalized = base.endsWith('/') ? base : `${base}/`;
  return `${normalized}${cid}`;
}

export interface FetchGatewayOptions {
  /** Race gateways concurrently instead of trying sequentially. */
  race?: boolean;
  /** Per-gateway request timeout in milliseconds. */
  timeoutMs?: number;
  /** Cryptographically verify retrieved content against the CID. */
  verifyCid?: boolean;
  /** Custom gateway list (defaults to `IPFS_GATEWAYS`). */
  gateways?: readonly string[];
  /** Optional health tracker instance (defaults to shared tracker). */
  healthTracker?: GatewayHealthTracker;
  /** Optional SHA-256 hex digest to verify content against. */
  verifyHash?: string;
}

export interface GatewayFetchResult {
  blob: Blob;
  gateway: string;
  verified: boolean;
  cidVerified?: boolean;
  latencyMs?: number;
}

async function fetchFromSingleGateway(
  base: string,
  cid: string,
  options: {
    verifyHash?: string;
    verifyCid?: boolean;
    timeoutMs: number;
    signal: AbortSignal;
    healthTracker?: GatewayHealthTracker;
  },
): Promise<GatewayFetchResult> {
  const url = buildGatewayUrlFromBase(base, cid);
  const startedAt = Date.now();
  const controller = new AbortController();

  const onParentAbort = () => controller.abort();
  if (options.signal.aborted) {
    controller.abort();
  } else {
    options.signal.addEventListener('abort', onParentAbort, { once: true });
  }

  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();

    let hashVerified = false;
    if (options.verifyHash) {
      const ok = await verifyContentHash(blob, options.verifyHash);
      if (!ok) throw new Error('Hash mismatch');
      hashVerified = true;
    }

    let cidVerified = false;
    if (options.verifyCid) {
      const cidCheck = await verifyCidContent(cid, blob);
      if (!cidCheck.valid) {
        throw new Error(cidCheck.reason ?? 'CID verification failed');
      }
      cidVerified = true;
    }

    const latencyMs = Date.now() - startedAt;
    options.healthTracker?.recordSuccess(base, latencyMs);
    return {
      blob,
      gateway: url,
      verified: hashVerified || cidVerified,
      cidVerified,
      latencyMs,
    };
  } catch (err) {
    // Do not penalize gateways that were simply aborted because another racer won.
    if (!options.signal.aborted) {
      options.healthTracker?.recordFailure(base);
    }
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener('abort', onParentAbort);
  }
}

/**
 * Race all candidate IPFS gateways concurrently with per-gateway timeouts and
 * cryptographic CID/SHA-256 verification (#1769).
 *
 * The first gateway to return valid, verified bytes wins and immediately aborts
 * all remaining in-flight gateway requests. Tampered or slow gateways lose the
 * race without failing the fetch as long as at least one healthy gateway succeeds.
 */
export async function raceGateways(
  cid: string,
  options: Omit<FetchGatewayOptions, 'race'> = {},
): Promise<GatewayFetchResult> {
  const verifyCid = options.verifyCid ?? true;
  if (verifyCid && !isValidCid(cid)) {
    throw new Error(`Invalid IPFS CID: ${cid}`);
  }

  const tracker = options.healthTracker ?? defaultGatewayHealthTracker;
  const gateways = tracker.rankGateways(options.gateways ?? IPFS_GATEWAYS);
  if (gateways.length === 0) {
    throw new Error('No IPFS gateways configured');
  }

  const timeoutMs = options.timeoutMs ?? configuredGatewayTimeoutMs();
  const raceController = new AbortController();

  const attempts = gateways.map((base) =>
    fetchFromSingleGateway(base, cid, {
      verifyHash: options.verifyHash,
      verifyCid,
      timeoutMs,
      signal: raceController.signal,
      healthTracker: tracker,
    }),
  );

  try {
    const winner = await Promise.any(attempts);
    // Cancel all losing requests immediately so we do not waste bandwidth.
    raceController.abort();
    return winner;
  } catch (err) {
    raceController.abort();
    if (err instanceof AggregateError) {
      const reasons = err.errors
        .map((e) => (e instanceof Error ? e.message : String(e)))
        .join('; ');
      throw new Error(`All IPFS gateways failed during race: ${reasons}`);
    }
    throw err instanceof Error ? err : new Error('All IPFS gateways failed');
  }
}

export async function fetchViaGateways(
  cid: string,
  verifyHash?: string,
  options: FetchGatewayOptions = {},
): Promise<GatewayFetchResult> {
  if (options.race) {
    return raceGateways(cid, {
      ...options,
      verifyHash: verifyHash ?? options.verifyHash,
    });
  }

  const gateways = options.gateways ?? IPFS_GATEWAYS;
  const timeoutMs = options.timeoutMs ?? configuredGatewayTimeoutMs();
  const tracker = options.healthTracker;
  let lastError: Error | null = null;

  for (let i = 0; i < gateways.length; i += 1) {
    const base = gateways[i];
    const url = buildGatewayUrlFromBase(base, cid);
    const startedAt = Date.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();

      if (verifyHash) {
        const verified = await verifyContentHash(blob, verifyHash);
        if (!verified) throw new Error('Hash mismatch');
      }

      let cidVerified = false;
      if (options.verifyCid) {
        const cidCheck = await verifyCidContent(cid, blob);
        if (!cidCheck.valid) {
          throw new Error(cidCheck.reason ?? 'CID verification failed');
        }
        cidVerified = true;
      }

      const latencyMs = Date.now() - startedAt;
      tracker?.recordSuccess(base, latencyMs);

      return {
        blob,
        gateway: url,
        verified: Boolean(verifyHash) || cidVerified,
        cidVerified,
        latencyMs,
      };
    } catch (err) {
      tracker?.recordFailure(base);
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError ?? new Error('All IPFS gateways failed');
}

export async function verifyContentHash(data: Blob | ArrayBuffer, expectedHex: string): Promise<boolean> {
  if (!expectedHex) return false;
  const buffer = data instanceof Blob ? await data.arrayBuffer() : data;
  const bytes = new Uint8Array(buffer);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const hashBuffer = await crypto.subtle.digest('SHA-256', copy);
  const hex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex === expectedHex.toLowerCase();
}
