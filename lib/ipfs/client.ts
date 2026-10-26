import { buildGatewayUrl, fetchViaGateways, verifyContentHash } from './gateways';

export interface IpfsUploadResult {
  cid: string;
  sha256: string;
  size: number;
  gatewayUrl: string;
}

export interface IpfsPinEntry {
  cid: string;
  sha256: string;
  name: string;
  size: number;
  pinnedAt: string;
  gatewayUrl: string;
}

const PIN_API = process.env.NEXT_PUBLIC_IPFS_PIN_API ?? '/api/ipfs/pin';

/** Compute SHA-256 hex digest using Web Crypto (browser-native). */
export async function computeSha256(file: Blob | ArrayBuffer): Promise<string> {
  const buffer = file instanceof Blob ? await file.arrayBuffer() : file;
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Upload file directly from the browser to the pinning API. */
export async function uploadToIpfs(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<IpfsUploadResult> {
  const sha256 = await computeSha256(file);
  onProgress?.(10);

  const form = new FormData();
  form.append('file', file);
  form.append('sha256', sha256);

  const xhr = new XMLHttpRequest();

  const result = await new Promise<IpfsUploadResult>((resolve, reject) => {
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress?.(10 + Math.round((e.loaded / e.total) * 80));
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText) as IpfsUploadResult;
          onProgress?.(100);
          resolve(data);
        } catch {
          reject(new Error('Invalid pin response'));
        }
      } else {
        reject(new Error(`Pin failed: ${xhr.status}`));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Network error during IPFS upload')));
    xhr.open('POST', PIN_API);
    xhr.send(form);
  });

  return result;
}

/** Retrieve pinned content with cryptographic hash verification and gateway fallback. */
export async function retrieveFromIpfs(
  cid: string,
  expectedSha256: string,
): Promise<{ blob: Blob; verified: boolean; gateway: string }> {
  const { blob, gateway, verified } = await fetchViaGateways(cid, expectedSha256);
  return { blob, verified, gateway };
}

export async function verifyRetrievedFile(blob: Blob, expectedSha256: string): Promise<boolean> {
  return verifyContentHash(blob, expectedSha256);
}

export function getPublicUrl(cid: string): string {
  return buildGatewayUrl(cid);
}

export function loadPinRegistry(): IpfsPinEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem('ipfs-pins') ?? '[]') as IpfsPinEntry[];
  } catch {
    return [];
  }
}

export function savePinEntry(entry: IpfsPinEntry): void {
  const existing = loadPinRegistry();
  localStorage.setItem('ipfs-pins', JSON.stringify([entry, ...existing.filter((e) => e.cid !== entry.cid)]));
}
