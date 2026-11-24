import { prisma } from '@/lib/prisma';

/**
 * IPFS pinning services (issues #1507, #1769).
 *
 * Supports multi-provider redundancy across >= 2 independent pinning providers
 * (Pinata, Filebase, self-hosted Kubo, and standard IPFS Pinning Service API).
 * The route must never fabricate a CID when external providers are configured.
 */

export interface PinResult {
  cid: string;
  size: number;
  providerPinId?: string;
}

export interface IpfsPinner {
  readonly name: string;
  pin(file: Blob, name: string): Promise<PinResult>;
  /** Optional remote pin-by-CID for re-pinning dropped content without re-upload. */
  pinByCid?(cid: string, name?: string): Promise<PinResult>;
  /** Optional provider-level check for whether `cid` is currently pinned. */
  hasPin?(cid: string): Promise<boolean>;
  /** Optional unpin support. */
  unpin?(cid: string): Promise<void>;
}

/** Pinning could not complete (provider down, unreachable, or not configured). */
export class PinUnavailableError extends Error {}

/** The uploaded bytes do not match the client-supplied sha256. */
export class HashMismatchError extends Error {}

const DEFAULT_PIN_TIMEOUT_MS = 15_000;

/** Pinata (https://docs.pinata.cloud) — fetch + FormData, so no SDK is needed. */
export class PinataPinner implements IpfsPinner {
  readonly name = 'pinata';

  constructor(
    private readonly keyId: string,
    private readonly secretKey: string,
  ) {}

  private authHeaders(): Record<string, string> {
    return {
      pinata_api_key: this.keyId,
      pinata_secret_api_key: this.secretKey,
    };
  }

  async pin(file: Blob, name: string): Promise<PinResult> {
    const form = new FormData();
    form.append('file', file, name);
    form.append('pinataMetadata', JSON.stringify({ name }));

    const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: this.authHeaders(),
      body: form,
      signal: AbortSignal.timeout(DEFAULT_PIN_TIMEOUT_MS),
    });
    if (!res.ok) throw new PinUnavailableError(`Pinata responded with ${res.status}`);

    const data = (await res.json()) as { IpfsHash?: string; PinSize?: number };
    if (!data.IpfsHash) throw new PinUnavailableError('Pinata returned no CID');
    return { cid: data.IpfsHash, size: data.PinSize ?? 0 };
  }

  async pinByCid(cid: string, name?: string): Promise<PinResult> {
    const res = await fetch('https://api.pinata.cloud/pinning/pinByHash', {
      method: 'POST',
      headers: {
        ...this.authHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        hashToPin: cid,
        ...(name ? { pinataMetadata: { name } } : {}),
      }),
      signal: AbortSignal.timeout(DEFAULT_PIN_TIMEOUT_MS),
    });
    if (!res.ok) throw new PinUnavailableError(`Pinata pinByHash responded with ${res.status}`);
    const data = (await res.json()) as { id?: string; ipfsHash?: string };
    return { cid: data.ipfsHash ?? cid, size: 0, providerPinId: data.id };
  }

  async hasPin(cid: string): Promise<boolean> {
    const res = await fetch(
      `https://api.pinata.cloud/data/pinList?hashContains=${encodeURIComponent(cid)}&status=pinned`,
      {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(DEFAULT_PIN_TIMEOUT_MS),
      },
    );
    if (!res.ok) return false;
    const data = (await res.json()) as { rows?: Array<{ ipfs_pin_hash?: string }> };
    return Boolean(data.rows?.some((row) => row.ipfs_pin_hash === cid));
  }

  async unpin(cid: string): Promise<void> {
    const res = await fetch(`https://api.pinata.cloud/pinning/unpin/${encodeURIComponent(cid)}`, {
      method: 'DELETE',
      headers: this.authHeaders(),
      signal: AbortSignal.timeout(DEFAULT_PIN_TIMEOUT_MS),
    });
    if (!res.ok && res.status !== 404) {
      throw new PinUnavailableError(`Pinata unpin responded with ${res.status}`);
    }
  }
}

/** Self-hosted Kubo (ipfs daemon) — used for local development and self-hosted redundancy. */
export class KuboPinner implements IpfsPinner {
  readonly name = 'kubo';

  constructor(private readonly rpcUrl: string) {}

  private base(): string {
    return this.rpcUrl.replace(/\/+$/, '');
  }

  async pin(file: Blob, name: string): Promise<PinResult> {
    const form = new FormData();
    form.append('file', file, name);

    const url = `${this.base()}/api/v0/add?cid-version=1&pin=true`;
    const res = await fetch(url, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(DEFAULT_PIN_TIMEOUT_MS),
    });
    if (!res.ok) throw new PinUnavailableError(`Kubo responded with ${res.status}`);

    // /add streams one JSON object per line; the last is the root entry.
    const lines = (await res.text()).trim().split('\n');
    const entry = JSON.parse(lines[lines.length - 1]) as {
      Hash?: string;
      Size?: string | number;
    };
    if (!entry.Hash) throw new PinUnavailableError('Kubo returned no CID');
    return { cid: entry.Hash, size: Number(entry.Size ?? 0) };
  }

  async pinByCid(cid: string): Promise<PinResult> {
    const url = `${this.base()}/api/v0/pin/add?arg=${encodeURIComponent(cid)}`;
    const res = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(DEFAULT_PIN_TIMEOUT_MS),
    });
    if (!res.ok) throw new PinUnavailableError(`Kubo pin/add responded with ${res.status}`);
    return { cid, size: 0 };
  }

  async hasPin(cid: string): Promise<boolean> {
    const url = `${this.base()}/api/v0/pin/ls?arg=${encodeURIComponent(cid)}`;
    const res = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(DEFAULT_PIN_TIMEOUT_MS),
    });
    return res.ok;
  }

  async unpin(cid: string): Promise<void> {
    const url = `${this.base()}/api/v0/pin/rm?arg=${encodeURIComponent(cid)}`;
    const res = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(DEFAULT_PIN_TIMEOUT_MS),
    });
    if (!res.ok && res.status !== 500) {
      throw new PinUnavailableError(`Kubo pin/rm responded with ${res.status}`);
    }
  }
}

/**
 * Filebase IPFS RPC pinning provider (https://docs.filebase.com/api-documentation/ipfs-pinning-service-api).
 * Provides an independent secondary pinning provider backed by Sia/IPFS.
 */
export class FilebasePinner implements IpfsPinner {
  readonly name = 'filebase';

  constructor(
    private readonly token: string,
    private readonly rpcBaseUrl = 'https://rpc.filebase.io',
  ) {}

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}` };
  }

  async pin(file: Blob, name: string): Promise<PinResult> {
    const form = new FormData();
    form.append('file', file, name);

    const url = `${this.rpcBaseUrl.replace(/\/+$/, '')}/api/v0/add?cid-version=1&pin=true`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.authHeaders(),
      body: form,
      signal: AbortSignal.timeout(DEFAULT_PIN_TIMEOUT_MS),
    });
    if (!res.ok) throw new PinUnavailableError(`Filebase responded with ${res.status}`);

    const lines = (await res.text()).trim().split('\n');
    const entry = JSON.parse(lines[lines.length - 1]) as {
      Hash?: string;
      Size?: string | number;
    };
    if (!entry.Hash) throw new PinUnavailableError('Filebase returned no CID');
    return { cid: entry.Hash, size: Number(entry.Size ?? 0) };
  }

  async pinByCid(cid: string, name?: string): Promise<PinResult> {
    const res = await fetch('https://api.filebase.io/v1/ipfs/pins', {
      method: 'POST',
      headers: {
        ...this.authHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cid, ...(name ? { name } : {}) }),
      signal: AbortSignal.timeout(DEFAULT_PIN_TIMEOUT_MS),
    });
    if (!res.ok) throw new PinUnavailableError(`Filebase pinByCid responded with ${res.status}`);
    const data = (await res.json()) as { requestid?: string; pin?: { cid?: string } };
    return { cid: data.pin?.cid ?? cid, size: 0, providerPinId: data.requestid };
  }

  async hasPin(cid: string): Promise<boolean> {
    const res = await fetch(
      `https://api.filebase.io/v1/ipfs/pins?cid=${encodeURIComponent(cid)}&status=pinned`,
      {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(DEFAULT_PIN_TIMEOUT_MS),
      },
    );
    if (!res.ok) return false;
    const data = (await res.json()) as { count?: number; results?: Array<{ status?: string }> };
    return Boolean((data.count ?? 0) > 0 || data.results?.some((r) => r.status === 'pinned'));
  }
}

/**
 * Generic IPFS Pinning Service API (PSA) client (spec: https://ipfs.github.io/pinning-services-api-spec).
 * Compatible with NFT.Storage, Web3.Storage, Estuary, 4EVERLAND, or any PSA endpoint.
 */
export class PinningServiceApiPinner implements IpfsPinner {
  readonly name: string;

  constructor(
    private readonly endpointUrl: string,
    private readonly bearerToken: string,
    providerName = 'psa',
  ) {
    this.name = providerName;
  }

  private base(): string {
    return this.endpointUrl.replace(/\/+$/, '');
  }

  async pin(file: Blob, name: string): Promise<PinResult> {
    const form = new FormData();
    form.append('file', file, name);
    const res = await fetch(`${this.base()}/add`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.bearerToken}` },
      body: form,
      signal: AbortSignal.timeout(DEFAULT_PIN_TIMEOUT_MS),
    });
    if (!res.ok) throw new PinUnavailableError(`${this.name} responded with ${res.status}`);
    const data = (await res.json()) as { cid?: string; Hash?: string; size?: number; Size?: number };
    const cid = data.cid ?? data.Hash;
    if (!cid) throw new PinUnavailableError(`${this.name} returned no CID`);
    return { cid, size: Number(data.size ?? data.Size ?? 0) };
  }

  async pinByCid(cid: string, name?: string): Promise<PinResult> {
    const res = await fetch(`${this.base()}/pins`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.bearerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cid, ...(name ? { name } : {}) }),
      signal: AbortSignal.timeout(DEFAULT_PIN_TIMEOUT_MS),
    });
    if (!res.ok) throw new PinUnavailableError(`${this.name} PSA /pins responded with ${res.status}`);
    const data = (await res.json()) as { requestid?: string; pin?: { cid?: string } };
    return { cid: data.pin?.cid ?? cid, size: 0, providerPinId: data.requestid };
  }

  async hasPin(cid: string): Promise<boolean> {
    const res = await fetch(
      `${this.base()}/pins?cid=${encodeURIComponent(cid)}&status=pinned`,
      {
        headers: { Authorization: `Bearer ${this.bearerToken}` },
        signal: AbortSignal.timeout(DEFAULT_PIN_TIMEOUT_MS),
      },
    );
    if (!res.ok) return false;
    const data = (await res.json()) as { count?: number; results?: Array<{ status?: string }> };
    return Boolean((data.count ?? 0) > 0 || data.results?.some((r) => r.status === 'pinned'));
  }
}

export interface ProviderPinOutcome {
  provider: string;
  ok: boolean;
  cid?: string;
  size?: number;
  providerPinId?: string;
  latencyMs: number;
  error?: string;
}

export interface MultiPinResult {
  cid: string;
  size: number;
  outcomes: ProviderPinOutcome[];
  succeededProviders: string[];
  failedProviders: string[];
  targetRedundancy: number;
  redundancyMet: boolean;
  degraded: boolean;
}

export interface MultiProviderPinnerOptions {
  /** Minimum number of providers desired for redundancy (default 2). */
  targetRedundancy?: number;
  /** If true, throw PinUnavailableError when fewer than `targetRedundancy` providers succeed. */
  requireQuorum?: boolean;
}

/**
 * Pins content concurrently to >= 2 independent IPFS providers (#1769).
 *
 * When a secondary provider is temporarily unreachable, pinning succeeds in
 * degraded mode (unless `requireQuorum: true`) and records the failed provider
 * so the periodic health monitor automatically re-pins once the provider recovers.
 */
export class MultiProviderPinner {
  private readonly targetRedundancy: number;
  private readonly requireQuorum: boolean;

  constructor(
    private readonly providers: IpfsPinner[],
    options: MultiProviderPinnerOptions = {},
  ) {
    this.targetRedundancy = Math.max(1, options.targetRedundancy ?? 2);
    this.requireQuorum = options.requireQuorum ?? false;
  }

  getProviders(): readonly IpfsPinner[] {
    return this.providers;
  }

  async pin(file: Blob, name: string): Promise<MultiPinResult> {
    if (this.providers.length === 0) {
      throw new PinUnavailableError('No IPFS pinning providers are configured');
    }

    const outcomes: ProviderPinOutcome[] = await Promise.all(
      this.providers.map(async (provider): Promise<ProviderPinOutcome> => {
        const startedAt = Date.now();
        try {
          const result = await provider.pin(file, name);
          return {
            provider: provider.name,
            ok: true,
            cid: result.cid,
            size: result.size,
            providerPinId: result.providerPinId,
            latencyMs: Date.now() - startedAt,
          };
        } catch (err) {
          return {
            provider: provider.name,
            ok: false,
            latencyMs: Date.now() - startedAt,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );

    const succeeded = outcomes.filter((o) => o.ok && o.cid);
    const failed = outcomes.filter((o) => !o.ok);

    if (succeeded.length === 0) {
      const details = failed.map((f) => `${f.provider}: ${f.error}`).join('; ');
      throw new PinUnavailableError(`All IPFS pinning providers failed (${details})`);
    }

    const effectiveTarget = Math.min(this.targetRedundancy, Math.max(2, this.providers.length));
    const redundancyMet = succeeded.length >= this.targetRedundancy;

    if (this.requireQuorum && !redundancyMet) {
      throw new PinUnavailableError(
        `IPFS pin quorum not met: pinned on ${succeeded.length}/${this.targetRedundancy} required providers`,
      );
    }

    const primary = succeeded[0];
    return {
      cid: primary.cid!,
      size: primary.size ?? 0,
      outcomes,
      succeededProviders: succeeded.map((s) => s.provider),
      failedProviders: failed.map((f) => f.provider),
      targetRedundancy: effectiveTarget,
      redundancyMet,
      degraded: failed.length > 0 || !redundancyMet,
    };
  }
}

/** Return all configured pinning providers (ordered by preference). */
export function getPinners(): IpfsPinner[] {
  const {
    PINATA_API_KEY,
    PINATA_SECRET_API_KEY,
    FILEBASE_IPFS_TOKEN,
    FILEBASE_IPFS_RPC_URL,
    IPFS_RPC_URL,
    IPFS_PSA_URL,
    IPFS_PSA_TOKEN,
    IPFS_PSA_NAME,
  } = process.env;

  const pinners: IpfsPinner[] = [];
  if (PINATA_API_KEY && PINATA_SECRET_API_KEY) {
    pinners.push(new PinataPinner(PINATA_API_KEY, PINATA_SECRET_API_KEY));
  }
  if (FILEBASE_IPFS_TOKEN) {
    pinners.push(new FilebasePinner(FILEBASE_IPFS_TOKEN, FILEBASE_IPFS_RPC_URL || undefined));
  }
  if (IPFS_PSA_URL && IPFS_PSA_TOKEN) {
    pinners.push(new PinningServiceApiPinner(IPFS_PSA_URL, IPFS_PSA_TOKEN, IPFS_PSA_NAME || 'psa'));
  }
  if (IPFS_RPC_URL) {
    pinners.push(new KuboPinner(IPFS_RPC_URL));
  }
  return pinners;
}

/** Pick the primary configured provider: Pinata in prod, Filebase/PSA/Kubo fallback, none = fail closed. */
export function getPinner(): IpfsPinner | null {
  return getPinners()[0] ?? null;
}

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  // Wrap in Uint8Array: jsdom/cross-realm ArrayBuffers are rejected by SubtleCrypto.
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(new Uint8Array(buffer));
  const digest = await crypto.subtle.digest('SHA-256', copy);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verify integrity, pin the file across all configured providers (>= 2 when
 * configured), and record the pin + per-provider replica status in Prisma.
 */
export async function pinFile(
  file: Blob,
  options: {
    name: string;
    expectedSha256?: string;
    ownerId?: string | null;
    providers?: IpfsPinner[];
    targetRedundancy?: number;
    requireQuorum?: boolean;
  },
): Promise<{
  cid: string;
  sha256: string;
  size: number;
  providers: ProviderPinOutcome[];
  redundancyMet: boolean;
  degraded: boolean;
}> {
  const sha256 = await sha256Hex(await file.arrayBuffer());
  if (options.expectedSha256 && sha256 !== options.expectedSha256.toLowerCase()) {
    throw new HashMismatchError('Hash mismatch');
  }

  const configured = options.providers ?? getPinners();
  if (configured.length === 0) {
    throw new PinUnavailableError('No IPFS pinning service is configured');
  }

  const configuredMin = Number(process.env.IPFS_MIN_PIN_PROVIDERS);
  const targetRedundancy =
    options.targetRedundancy ?? (Number.isFinite(configuredMin) && configuredMin > 0 ? configuredMin : 2);

  const multi = new MultiProviderPinner(configured, {
    targetRedundancy,
    requireQuorum: options.requireQuorum ?? false,
  });

  const result = await multi.pin(file, options.name);

  await prisma.pinnedFile.upsert({
    where: { cid: result.cid },
    update: {},
    create: {
      cid: result.cid,
      sha256,
      size: result.size,
      ownerId: options.ownerId ?? null,
    },
  });

  const now = new Date();
  await Promise.allSettled(
    result.outcomes.map((outcome) =>
      prisma.ipfsPinReplica.upsert({
        where: { cid_provider: { cid: result.cid, provider: outcome.provider } },
        update: {
          status: outcome.ok ? 'PINNED' : 'FAILED',
          providerPinId: outcome.providerPinId ?? undefined,
          lastCheckedAt: now,
          lastHealthyAt: outcome.ok ? now : undefined,
          consecutiveFailures: outcome.ok ? 0 : { increment: 1 },
          lastLatencyMs: outcome.latencyMs,
          lastError: outcome.ok ? null : (outcome.error ?? 'Pin failed'),
        },
        create: {
          cid: result.cid,
          provider: outcome.provider,
          providerPinId: outcome.providerPinId ?? null,
          status: outcome.ok ? 'PINNED' : 'FAILED',
          lastCheckedAt: now,
          lastHealthyAt: outcome.ok ? now : null,
          consecutiveFailures: outcome.ok ? 0 : 1,
          lastLatencyMs: outcome.latencyMs,
          lastError: outcome.ok ? null : (outcome.error ?? 'Pin failed'),
        },
      }),
    ),
  );

  return {
    cid: result.cid,
    sha256,
    size: result.size,
    providers: result.outcomes,
    redundancyMet: result.redundancyMet,
    degraded: result.degraded,
  };
}
