/**
 * SEP-23 Muxed Account Parsing and Proof-of-Reserve Verification with Rust API Parity.
 *
 * Provides shared validation matching backend/services/api/src/muxed.rs and
 * backend/services/api/src/asset_verifier.rs using canonical test vectors from
 * fixtures/stellar-parity/vectors.json.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// ── Base32 (RFC 4648, uppercase, no padding) ─────────────────────────────────

export function base32Decode(input: string): Uint8Array {
  if (typeof input !== 'string') {
    throw new Error('InvalidBase32');
  }

  const table: number[] = new Array(256).fill(255);
  for (let i = 0; i < BASE32_ALPHABET.length; i++) {
    table[BASE32_ALPHABET.charCodeAt(i)] = i;
  }

  let buf = 0;
  let bits = 0;
  const out: number[] = [];

  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    const val = code < 256 ? table[code] : 255;
    if (val === 255) {
      throw new Error('InvalidBase32');
    }
    buf = (buf << 5) | val;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
      buf &= (1 << bits) - 1;
    }
  }

  return new Uint8Array(out);
}

export function base32Encode(data: Uint8Array): string {
  let out = '';
  let buf = 0;
  let bits = 0;

  for (let i = 0; i < data.length; i++) {
    buf = (buf << 8) | data[i];
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET[(buf >> bits) & 0x1f];
      buf &= (1 << bits) - 1;
    }
  }

  if (bits > 0) {
    out += BASE32_ALPHABET[(buf << (5 - bits)) & 0x1f];
  }

  return out;
}

// ── CRC-16/XModem ────────────────────────────────────────────────────────────

export function crc16XModem(data: Uint8Array): number {
  let crc = 0x0000;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i] << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc;
}

// ── StrKey Encode for G-address ──────────────────────────────────────────────

export function strkeyEncodeGAddress(rawKey: Uint8Array): string {
  if (rawKey.length !== 32) {
    throw new Error('Invalid raw key length: expected 32 bytes');
  }
  const payload = new Uint8Array(35);
  payload[0] = 0x30; // VERSION_ACCOUNT: 0x06 << 3 = 0x30 per StrKey spec
  payload.set(rawKey, 1);
  const crc = crc16XModem(payload.subarray(0, 33));
  payload[33] = crc & 0xff;
  payload[34] = (crc >> 8) & 0xff;
  return base32Encode(payload);
}

// ── Stellar Account Parsing ──────────────────────────────────────────────────

export interface StellarAccountResult {
  baseAccount: string;
  muxedId: number | bigint | null;
  isMuxed: boolean;
  analyticsId: string;
}

export function parseStellarAccount(account: string): StellarAccountResult {
  if (!account || typeof account !== 'string' || account.trim() === '') {
    throw new Error('EmptyAccount');
  }

  if (account.startsWith('G')) {
    if (account.length !== 56 || !/^[A-Z2-7]+$/.test(account)) {
      throw new Error('InvalidFormat');
    }
    return {
      baseAccount: account,
      muxedId: null,
      isMuxed: false,
      analyticsId: account,
    };
  }

  if (account.startsWith('M')) {
    const decoded = base32Decode(account);
    if (decoded.length !== 43) {
      throw new Error('InvalidMuxedFormat');
    }

    const payload = decoded.subarray(0, 41);
    const expectedCrc = crc16XModem(payload);
    const actualCrc = decoded[41] | (decoded[42] << 8);
    if (expectedCrc !== actualCrc) {
      throw new Error('InvalidChecksum');
    }

    if (payload[0] !== 0x60) {
      throw new Error('InvalidVersionByte');
    }

    // 8-byte big endian muxed ID
    let muxedId = BigInt(0);
    for (let i = 1; i <= 8; i++) {
      muxedId = (muxedId << BigInt(8)) | BigInt(payload[i]);
    }

    const rawKey = payload.subarray(9, 41);
    const baseAccount = strkeyEncodeGAddress(rawKey);
    const muxedIdNum = muxedId <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(muxedId) : muxedId;
    const muxedIdStr = muxedId.toString();

    return {
      baseAccount,
      muxedId: muxedIdNum,
      isMuxed: true,
      analyticsId: `${baseAccount}:${muxedIdStr}`,
    };
  }

  throw new Error('InvalidFormat');
}

// ── Asset Reserve Verification ───────────────────────────────────────────────

const STROOP_SCALE = BigInt('10000000');

export interface DeclaredReserves {
  asset_code: string;
  asset_issuer: string;
  issuer_account: string;
  issuer_reserve: string;
  treasury_account: string;
  treasury_reserve: string;
}

export interface ObservedReserves {
  issuer_balance: string;
  treasury_balance: string;
}

export interface ReserveMismatch {
  account_role: string;
  account_id: string;
  declared: string;
  observed: string;
}

export interface ProofOfReserveReport {
  valid: boolean;
  mismatches: ReserveMismatch[];
}

export function parseStroops(amount: string): bigint {
  const trimmed = amount.trim();
  if (trimmed === '') {
    throw new Error('InvalidReserveAmount');
  }

  const parts = trimmed.split('.');
  if (parts.length > 2) {
    throw new Error('InvalidReserveAmount');
  }

  const whole = parts[0];
  const fraction = parts[1] ?? '';

  if (!/^\d+$/.test(whole) || (fraction.length > 0 && !/^\d+$/.test(fraction))) {
    throw new Error('InvalidReserveAmount');
  }

  if (fraction.length > 7) {
    throw new Error('InvalidReserveAmount');
  }

  const wholeUnits = BigInt(whole);
  const fractionPadded = fraction.padEnd(7, '0');
  const fractionUnits = fractionPadded === '' ? BigInt(0) : BigInt(fractionPadded);

  return wholeUnits * STROOP_SCALE + fractionUnits;
}

export function validateProofOfReserve(
  declared: DeclaredReserves,
  observed: ObservedReserves,
): ProofOfReserveReport {
  const declaredIssuer = parseStroops(declared.issuer_reserve);
  const observedIssuer = parseStroops(observed.issuer_balance);
  const declaredTreasury = parseStroops(declared.treasury_reserve);
  const observedTreasury = parseStroops(observed.treasury_balance);

  const mismatches: ReserveMismatch[] = [];

  if (declaredIssuer !== observedIssuer) {
    mismatches.push({
      account_role: 'issuer',
      account_id: declared.issuer_account,
      declared: declared.issuer_reserve,
      observed: observed.issuer_balance,
    });
  }

  if (declaredTreasury !== observedTreasury) {
    mismatches.push({
      account_role: 'treasury',
      account_id: declared.treasury_account,
      declared: declared.treasury_reserve,
      observed: observed.treasury_balance,
    });
  }

  return {
    valid: mismatches.length === 0,
    mismatches,
  };
}

// ── HTTP API Client Helpers (Single API Implementation) ──────────────────────

export async function parseAccountViaApi(
  account: string,
  apiBase = '/api/v1',
): Promise<StellarAccountResult> {
  const res = await fetch(`${apiBase}/stellar/accounts/parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account }),
  });

  if (!res.ok) {
    const errorJson = await res.json().catch(() => ({}));
    throw new Error(errorJson.error || `HTTP ${res.status}`);
  }

  const data = await res.json();
  return {
    baseAccount: data.base_account,
    muxedId: data.muxed_id,
    isMuxed: data.is_muxed,
    analyticsId: data.analytics_id,
  };
}

export async function verifyReservesViaApi(
  declared: DeclaredReserves,
  observed: ObservedReserves,
  apiBase = '/api/v1',
): Promise<ProofOfReserveReport> {
  const res = await fetch(`${apiBase}/stellar/reserves/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ declared, observed }),
  });

  if (!res.ok) {
    const errorJson = await res.json().catch(() => ({}));
    throw new Error(errorJson.error || `HTTP ${res.status}`);
  }

  return res.json();
}
