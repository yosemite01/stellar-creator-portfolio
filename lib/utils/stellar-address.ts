import { StrKey } from '@stellar/stellar-sdk';

/**
 * True for a syntactically valid Stellar Ed25519 public key (G..., 56 chars,
 * correct checksum) — format/checksum only, no on-chain existence check.
 */
export function isValidStellarAddress(address: unknown): boolean {
  if (typeof address !== 'string') return false;
  const trimmed = address.trim();
  if (trimmed.length !== 56 || !trimmed.startsWith('G')) {
    return false;
  }
  return StrKey.isValidEd25519PublicKey(trimmed);
}

