/**
 * Escrow token allowlist for the UI (#1715).
 *
 * The escrow contract only accepts deposits in tokens the platform admin has
 * added with `allow_token`, and rejects any token whose transfer does not
 * move exactly the requested amount. The UI mirrors that list so users can't
 * pick an arbitrary token contract that would fail on-chain.
 *
 * Configure with `NEXT_PUBLIC_ESCROW_ALLOWED_TOKENS`, a comma-separated list
 * of `CODE:CONTRACT_ID` pairs, e.g.
 * `USDC:CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`.
 * Keep it in sync with the on-chain allowlist (`is_token_allowed`).
 */

export interface AllowedEscrowToken {
  code: string;
  contractId: string;
}

const CONTRACT_ID = /^C[A-Z2-7]{55}$/;

export function parseAllowedEscrowTokens(raw: string | undefined): AllowedEscrowToken[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const tokens: AllowedEscrowToken[] = [];
  for (const entry of raw.split(',')) {
    const [code, contractId] = entry.split(':').map((part) => part?.trim() ?? '');
    if (!code || !contractId || !CONTRACT_ID.test(contractId) || seen.has(contractId)) continue;
    seen.add(contractId);
    tokens.push({ code: code.toUpperCase(), contractId });
  }
  return tokens;
}

export function getAllowedEscrowTokens(): AllowedEscrowToken[] {
  return parseAllowedEscrowTokens(process.env.NEXT_PUBLIC_ESCROW_ALLOWED_TOKENS);
}

export function isAllowedEscrowToken(
  contractId: string,
  tokens: AllowedEscrowToken[] = getAllowedEscrowTokens(),
): boolean {
  return tokens.some((t) => t.contractId === contractId.trim());
}
