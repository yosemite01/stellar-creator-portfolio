import { describe, expect, it } from 'vitest';
import { isAllowedEscrowToken, parseAllowedEscrowTokens } from '@/lib/escrow/allowed-tokens';

const USDC = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const EURC = 'CCUUDM434BMZMYWYDITHFXHDMIVTGGD6T2I5UKNX5BSLXLW7HVR4MCGZ';

describe('escrow token allowlist (#1715)', () => {
  it('parses CODE:CONTRACT_ID pairs', () => {
    expect(parseAllowedEscrowTokens(`usdc:${USDC}, EURC:${EURC}`)).toEqual([
      { code: 'USDC', contractId: USDC },
      { code: 'EURC', contractId: EURC },
    ]);
  });

  it('returns an empty list when unset', () => {
    expect(parseAllowedEscrowTokens(undefined)).toEqual([]);
    expect(parseAllowedEscrowTokens('')).toEqual([]);
  });

  it('drops malformed and duplicate entries', () => {
    expect(
      parseAllowedEscrowTokens(`USDC:${USDC},BAD:not-a-contract,:${EURC},DUP:${USDC},GABC`),
    ).toEqual([{ code: 'USDC', contractId: USDC }]);
  });

  it('only accepts allowlisted contract ids', () => {
    const tokens = parseAllowedEscrowTokens(`USDC:${USDC}`);
    expect(isAllowedEscrowToken(USDC, tokens)).toBe(true);
    expect(isAllowedEscrowToken(` ${USDC} `, tokens)).toBe(true);
    expect(isAllowedEscrowToken(EURC, tokens)).toBe(false);
    expect(isAllowedEscrowToken('USDC_TOKEN_ADDRESS', tokens)).toBe(false);
  });
});
