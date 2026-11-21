/**
 * Pure TypeScript IPFS CID structural validation and cryptographic content
 * verification (Issue #1769).
 *
 * Supports:
 * - CIDv1 raw (`bafkrei...`, codec 0x55, sha2-256 multihash 0x12 0x20)
 * - CIDv1 dag-pb (`bafybei...`, codec 0x70, sha2-256) for single-block UnixFS files
 * - CIDv0 (`Qm...`, base58btc sha2-256 multihash) for single-block UnixFS files
 * - Deterministic local/dev fallback CIDs (`bafy<first 52 hex chars of sha256>`)
 *
 * Zero runtime dependencies: works identically in Node.js and browser WebCrypto.
 */

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const BASE32_LOOKUP: Record<string, number> = Object.fromEntries(
  Array.from(BASE32_ALPHABET).map((ch, idx) => [ch, idx]),
);

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_LOOKUP: Record<string, number> = Object.fromEntries(
  Array.from(BASE58_ALPHABET).map((ch, idx) => [ch, idx]),
);

const DEV_FALLBACK_CID_RE = /^bafy[0-9a-f]{52}$/;
const CIDV0_RE = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;
const CIDV1_BASE32_RE = /^b[a-z2-7]{10,}$/;

export function encodeBase32Lower(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';

  for (let i = 0; i < bytes.length; i += 1) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET[(value >>> bits) & 31];
    }
  }

  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return out;
}

export function decodeBase32Lower(input: string): Uint8Array | null {
  if (!input) return null;
  let bits = 0;
  let value = 0;
  const out: number[] = [];

  for (let i = 0; i < input.length; i += 1) {
    const idx = BASE32_LOOKUP[input[i]];
    if (idx === undefined) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }

  return new Uint8Array(out);
}

export function decodeBase58(input: string): Uint8Array | null {
  if (!input) return null;
  const bytes: number[] = [0];

  for (let i = 0; i < input.length; i += 1) {
    const val = BASE58_LOOKUP[input[i]];
    if (val === undefined) return null;
    let carry = val;
    for (let j = 0; j < bytes.length; j += 1) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  let leadingZeros = 0;
  while (leadingZeros < input.length && input[leadingZeros] === '1') {
    leadingZeros += 1;
  }

  const out = new Uint8Array(leadingZeros + bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    out[out.length - 1 - i] = bytes[i];
  }
  return out;
}

function encodeVarint(n: number): number[] {
  const out: number[] = [];
  let v = n >>> 0;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
  return out;
}

function decodeVarint(bytes: Uint8Array, offset: number): { value: number; next: number } | null {
  let value = 0;
  let shift = 0;
  let idx = offset;
  while (idx < bytes.length && shift <= 35) {
    const b = bytes[idx];
    value |= (b & 0x7f) << shift;
    idx += 1;
    if ((b & 0x80) === 0) {
      return { value, next: idx };
    }
    shift += 7;
  }
  return null;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Bytes(bytes: Uint8Array): Promise<Uint8Array> {
  // Always copy into a fresh Uint8Array backed by a standard ArrayBuffer to
  // avoid jsdom cross-realm ArrayBuffer rejections in SubtleCrypto.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy);
  return new Uint8Array(digest);
}

/**
 * Wrap single-chunk raw file bytes into the canonical UnixFS File protobuf
 * inside a dag-pb PBNode (`Data` field 1 = 0x0a). Used to verify single-block
 * CIDv0 (`Qm...`) and CIDv1 dag-pb (`bafybei...`) hashes.
 */
function wrapSingleBlockUnixFsDagPb(data: Uint8Array): Uint8Array {
  const lenVarint = encodeVarint(data.byteLength);
  // UnixFS Data message: field 1 Type=File(2) [0x08, 0x02],
  // field 2 Data [0x12, ...len, ...bytes], field 3 filesize [0x18, ...len]
  const unixFsLength = 2 + (data.byteLength > 0 ? 1 + lenVarint.length + data.byteLength : 0) + 1 + lenVarint.length;
  const unixFs = new Uint8Array(unixFsLength);
  let p = 0;
  unixFs[p++] = 0x08;
  unixFs[p++] = 0x02;
  if (data.byteLength > 0) {
    unixFs[p++] = 0x12;
    for (const b of lenVarint) unixFs[p++] = b;
    unixFs.set(data, p);
    p += data.byteLength;
  }
  unixFs[p++] = 0x18;
  for (const b of lenVarint) unixFs[p++] = b;

  // dag-pb PBNode: field 1 Data = 0x0a, length varint, unixFs bytes
  const pbNodeLenVarint = encodeVarint(unixFs.byteLength);
  const pbNode = new Uint8Array(1 + pbNodeLenVarint.length + unixFs.byteLength);
  pbNode[0] = 0x0a;
  pbNode.set(pbNodeLenVarint, 1);
  pbNode.set(unixFs, 1 + pbNodeLenVarint.length);
  return pbNode;
}

export interface ParsedCid {
  version: 0 | 1;
  codec: number;
  hashCode: number;
  digestHex: string;
}

/**
 * Parse a CIDv0 (`Qm...`) or base32 CIDv1 (`b...`) into its multicodec and
 * multihash components. Returns null for invalid or non-standard CIDs.
 */
export function parseCid(cid: string): ParsedCid | null {
  if (!cid || /[\s/\\?#]/.test(cid) || cid.includes('..')) {
    return null;
  }

  if (CIDV0_RE.test(cid)) {
    const raw = decodeBase58(cid);
    if (!raw || raw.length !== 34 || raw[0] !== 0x12 || raw[1] !== 0x20) {
      return null;
    }
    return {
      version: 0,
      codec: 0x70, // dag-pb
      hashCode: 0x12, // sha2-256
      digestHex: bytesToHex(raw.subarray(2)),
    };
  }

  if (CIDV1_BASE32_RE.test(cid)) {
    const raw = decodeBase32Lower(cid.slice(1));
    if (!raw || raw.length < 4) return null;

    const ver = decodeVarint(raw, 0);
    if (!ver || ver.value !== 1) return null;

    const codec = decodeVarint(raw, ver.next);
    if (!codec) return null;

    const hashCode = decodeVarint(raw, codec.next);
    if (!hashCode) return null;

    const hashLen = decodeVarint(raw, hashCode.next);
    if (!hashLen || hashLen.value <= 0) return null;

    const digest = raw.subarray(hashLen.next, hashLen.next + hashLen.value);
    if (digest.length !== hashLen.value) return null;

    return {
      version: 1,
      codec: codec.value,
      hashCode: hashCode.value,
      digestHex: bytesToHex(digest),
    };
  }

  return null;
}

/**
 * Validate whether `cid` is a structurally safe IPFS CID (CIDv0, CIDv1 base32,
 * or local deterministic `bafy<52 hex>` CID). Rejects path traversal and injection.
 */
export function isValidCid(cid: string): boolean {
  if (!cid || typeof cid !== 'string') return false;
  if (/[\s/\\?#]/.test(cid) || cid.includes('..')) return false;
  if (DEV_FALLBACK_CID_RE.test(cid)) return true;
  return parseCid(cid) !== null;
}

/**
 * Compute a spec-compliant CIDv1 raw (`bafkrei...`) from arbitrary bytes.
 */
export async function computeRawCidV1(data: Blob | ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = await toUint8Array(data);
  const digest = await sha256Bytes(bytes);
  const cidBytes = new Uint8Array(4 + digest.length);
  cidBytes[0] = 0x01; // CIDv1
  cidBytes[1] = 0x55; // raw multicodec
  cidBytes[2] = 0x12; // sha2-256
  cidBytes[3] = 0x20; // 32 bytes
  cidBytes.set(digest, 4);
  return `b${encodeBase32Lower(cidBytes)}`;
}

async function toUint8Array(data: Blob | ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (
    data instanceof ArrayBuffer ||
    (typeof data === 'object' && data !== null && 'byteLength' in data && !('arrayBuffer' in data))
  ) {
    return new Uint8Array(data as ArrayBuffer);
  }
  return new Uint8Array(await (data as Blob).arrayBuffer());
}

export interface CidVerificationResult {
  valid: boolean;
  computedSha256: string;
  method:
    | 'cidv1-raw'
    | 'cidv1-dag-pb'
    | 'cidv0-dag-pb'
    | 'deterministic-dev'
    | 'invalid-cid'
    | 'mismatch';
  reason?: string;
}

/**
 * Cryptographically verify that fetched content matches `cid`.
 *
 * - For CIDv1 raw (`0x55`, sha2-256): verifies SHA-256(bytes) === cid.digest.
 * - For CIDv1 dag-pb (`0x70`) and CIDv0 (`Qm...`): verifies SHA-256(UnixFS(bytes))
 *   or SHA-256(bytes) === cid.digest (covering single-block IPFS files).
 * - For local deterministic dev CIDs (`bafy<sha256[:52]>`): verifies prefix match.
 */
export async function verifyCidContent(
  cid: string,
  data: Blob | ArrayBuffer | Uint8Array,
): Promise<CidVerificationResult> {
  const bytes = await toUint8Array(data);
  const rawDigestBytes = await sha256Bytes(bytes);
  const computedSha256 = bytesToHex(rawDigestBytes);

  if (!isValidCid(cid)) {
    return {
      valid: false,
      computedSha256,
      method: 'invalid-cid',
      reason: `Malformed or unsafe CID: ${cid}`,
    };
  }

  // Deterministic dev fallback format: bafy + first 52 hex chars of sha256
  if (DEV_FALLBACK_CID_RE.test(cid)) {
    const expectedPrefix = `bafy${computedSha256.slice(0, 52)}`;
    if (cid === expectedPrefix) {
      return { valid: true, computedSha256, method: 'deterministic-dev' };
    }
    return {
      valid: false,
      computedSha256,
      method: 'mismatch',
      reason: 'Content SHA-256 does not match deterministic CID',
    };
  }

  const parsed = parseCid(cid);
  if (!parsed) {
    return {
      valid: false,
      computedSha256,
      method: 'invalid-cid',
      reason: `Unable to parse CID: ${cid}`,
    };
  }

  if (parsed.hashCode !== 0x12) {
    return {
      valid: false,
      computedSha256,
      method: 'mismatch',
      reason: `Unsupported multihash code 0x${parsed.hashCode.toString(16)}`,
    };
  }

  // CIDv1 raw (0x55): digest is directly SHA-256(raw bytes)
  if (parsed.version === 1 && parsed.codec === 0x55) {
    if (computedSha256 === parsed.digestHex) {
      return { valid: true, computedSha256, method: 'cidv1-raw' };
    }
    return {
      valid: false,
      computedSha256,
      method: 'mismatch',
      reason: 'CIDv1 raw SHA-256 digest mismatch',
    };
  }

  // CIDv0 or CIDv1 dag-pb (0x70): check raw match or single-block UnixFS dag-pb match
  if (parsed.codec === 0x70) {
    if (computedSha256 === parsed.digestHex) {
      return {
        valid: true,
        computedSha256,
        method: parsed.version === 0 ? 'cidv0-dag-pb' : 'cidv1-dag-pb',
      };
    }

    const wrapped = wrapSingleBlockUnixFsDagPb(bytes);
    const wrappedDigestHex = bytesToHex(await sha256Bytes(wrapped));
    if (wrappedDigestHex === parsed.digestHex) {
      return {
        valid: true,
        computedSha256,
        method: parsed.version === 0 ? 'cidv0-dag-pb' : 'cidv1-dag-pb',
      };
    }

    return {
      valid: false,
      computedSha256,
      method: 'mismatch',
      reason: 'CID dag-pb content digest mismatch',
    };
  }

  return {
    valid: false,
    computedSha256,
    method: 'mismatch',
    reason: `Unsupported CID codec 0x${parsed.codec.toString(16)}`,
  };
}
