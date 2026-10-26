import { prisma } from '@/lib/prisma';

/**
 * IPFS pinning services (issue #1507). The route must never fabricate a CID:
 * the only acceptable source of a CID is a real pinning provider.
 */

export interface PinResult {
  cid: string;
  size: number;
}

export interface IpfsPinner {
  pin(file: Blob, name: string): Promise<PinResult>;
}

/** Pinning could not complete (provider down, unreachable, or not configured). */
export class PinUnavailableError extends Error {}

/** The uploaded bytes do not match the client-supplied sha256. */
export class HashMismatchError extends Error {}

/** Pinata (https://docs.pinata.cloud) — fetch + FormData, so no SDK is needed. */
export class PinataPinner implements IpfsPinner {
  constructor(
    private readonly keyId: string,
    private readonly secretKey: string,
  ) {}

  async pin(file: Blob, name: string): Promise<PinResult> {
    const form = new FormData();
    form.append('file', file, name);
    form.append('pinataMetadata', JSON.stringify({ name }));

    const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: { pinata_api_key: this.keyId, pinata_secret_api_key: this.secretKey },
      body: form,
    });
    if (!res.ok) throw new PinUnavailableError(`Pinata responded with ${res.status}`);

    const data = (await res.json()) as { IpfsHash?: string; PinSize?: number };
    if (!data.IpfsHash) throw new PinUnavailableError('Pinata returned no CID');
    return { cid: data.IpfsHash, size: data.PinSize ?? 0 };
  }
}

/** Self-hosted Kubo (ipfs daemon) — used for local development. */
export class KuboPinner implements IpfsPinner {
  constructor(private readonly rpcUrl: string) {}

  async pin(file: Blob, name: string): Promise<PinResult> {
    const form = new FormData();
    form.append('file', file, name);

    const url = `${this.rpcUrl.replace(/\/+$/, '')}/api/v0/add?cid-version=1&pin=true`;
    const res = await fetch(url, { method: 'POST', body: form });
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
}

/** Pick the configured provider: Pinata in prod, Kubo for dev, none = fail closed. */
export function getPinner(): IpfsPinner | null {
  const { PINATA_API_KEY, PINATA_SECRET_API_KEY, IPFS_RPC_URL } = process.env;
  if (PINATA_API_KEY && PINATA_SECRET_API_KEY) {
    return new PinataPinner(PINATA_API_KEY, PINATA_SECRET_API_KEY);
  }
  if (IPFS_RPC_URL) return new KuboPinner(IPFS_RPC_URL);
  return null;
}

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  // Wrap in Uint8Array: jsdom/cross-realm ArrayBuffers are rejected by SubtleCrypto.
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(buffer));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verify integrity, pin the file with the configured provider, and record the
 * pin (de-duplicated by CID). Throws HashMismatchError or PinUnavailableError;
 * on any failure no CID is produced.
 */
export async function pinFile(
  file: Blob,
  options: { name: string; expectedSha256?: string; ownerId?: string | null },
): Promise<{ cid: string; sha256: string; size: number }> {
  const sha256 = await sha256Hex(await file.arrayBuffer());
  if (options.expectedSha256 && sha256 !== options.expectedSha256.toLowerCase()) {
    throw new HashMismatchError('Hash mismatch');
  }

  const pinner = getPinner();
  if (!pinner) throw new PinUnavailableError('No IPFS pinning service is configured');

  let pinned: PinResult;
  try {
    pinned = await pinner.pin(file, options.name);
  } catch (err) {
    if (err instanceof PinUnavailableError) throw err;
    throw new PinUnavailableError(err instanceof Error ? err.message : String(err));
  }

  await prisma.pinnedFile.upsert({
    where: { cid: pinned.cid },
    update: {},
    create: {
      cid: pinned.cid,
      sha256,
      size: pinned.size,
      ownerId: options.ownerId ?? null,
    },
  });

  return { cid: pinned.cid, sha256, size: pinned.size };
}
