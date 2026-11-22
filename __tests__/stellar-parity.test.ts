import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  base32Decode,
  base32Encode,
  crc16XModem,
  parseAccountViaApi,
  parseStellarAccount,
  parseStroops,
  strkeyEncodeGAddress,
  validateProofOfReserve,
  verifyReservesViaApi,
} from '../lib/stellar-parity';

interface VectorFile {
  version: string;
  muxed_accounts: Array<{
    id: string;
    description: string;
    input: string;
    valid: boolean;
    expected?: {
      base_account: string;
      muxed_id: number | null;
      is_muxed: boolean;
      analytics_id: string;
    };
    expected_error?: string;
  }>;
  reserves_verification: Array<{
    id: string;
    description: string;
    declared: {
      asset_code: string;
      asset_issuer: string;
      issuer_account: string;
      issuer_reserve: string;
      treasury_account: string;
      treasury_reserve: string;
    };
    observed: {
      issuer_balance: string;
      treasury_balance: string;
    };
    valid_input: boolean;
    expected_valid?: boolean;
    expected_mismatches?: Array<{
      account_role: string;
      account_id: string;
      declared: string;
      observed: string;
    }>;
    expected_error?: string;
  }>;
}

const vectorsPath = path.resolve(__dirname, '../fixtures/stellar-parity/vectors.json');
const vectors: VectorFile = JSON.parse(fs.readFileSync(vectorsPath, 'utf-8'));

describe('Stellar Parity - Shared Test Vectors', () => {
  describe('SEP-23 Muxed Account Parsing Vectors', () => {
    for (const vector of vectors.muxed_accounts) {
      it(`passes vector ${vector.id} (${vector.description})`, () => {
        if (vector.valid) {
          const result = parseStellarAccount(vector.input);
          expect(result.baseAccount).toBe(vector.expected!.base_account);
          if (vector.expected!.muxed_id === null) {
            expect(result.muxedId).toBeNull();
          } else {
            expect(Number(result.muxedId)).toBe(vector.expected!.muxed_id);
          }
          expect(result.isMuxed).toBe(vector.expected!.is_muxed);
          expect(result.analyticsId).toBe(vector.expected!.analytics_id);
        } else {
          expect(() => parseStellarAccount(vector.input)).toThrow(vector.expected_error);
        }
      });
    }
  });

  describe('Proof-of-Reserve Verification Vectors', () => {
    for (const vector of vectors.reserves_verification) {
      it(`passes vector ${vector.id} (${vector.description})`, () => {
        if (vector.valid_input) {
          const report = validateProofOfReserve(vector.declared, vector.observed);
          expect(report.valid).toBe(vector.expected_valid);
          expect(report.mismatches).toHaveLength(vector.expected_mismatches!.length);
          for (let i = 0; i < report.mismatches.length; i++) {
            const actual = report.mismatches[i];
            const expected = vector.expected_mismatches![i];
            expect(actual.account_role).toBe(expected.account_role);
            expect(actual.account_id).toBe(expected.account_id);
            expect(actual.declared).toBe(expected.declared);
            expect(actual.observed).toBe(expected.observed);
          }
        } else {
          expect(() => validateProofOfReserve(vector.declared, vector.observed)).toThrow(
            vector.expected_error,
          );
        }
      });
    }
  });

  describe('Unit Primitives & Parity Helpers', () => {
    it('computes CRC16-XModem known test vector', () => {
      const data = new TextEncoder().encode('123456789');
      expect(crc16XModem(data)).toBe(0x31c3);
    });

    it('round-trips Base32 encoding and decoding', () => {
      const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 255, 128, 42]);
      const encoded = base32Encode(bytes);
      const decoded = base32Decode(encoded);
      expect(Array.from(decoded)).toEqual(Array.from(bytes));
    });

    it('parses fractional stroops correctly', () => {
      expect(parseStroops('10.0000001')).toBe(BigInt('100000001'));
      expect(parseStroops('0.0000001')).toBe(BigInt('1'));
      expect(parseStroops('500')).toBe(BigInt('5000000000'));
      expect(() => parseStroops('10.00000001')).toThrow('InvalidReserveAmount');
      expect(() => parseStroops('invalid')).toThrow('InvalidReserveAmount');
    });

    it('invokes single implementation API for parseAccountViaApi', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          base_account: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          muxed_id: 1,
          is_muxed: true,
          analytics_id: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN:1',
        }),
      });
      global.fetch = mockFetch;

      const res = await parseAccountViaApi(
        'MAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACTA4',
      );
      expect(res.baseAccount).toBe('GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN');
      expect(res.isMuxed).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/stellar/accounts/parse',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('invokes single implementation API for verifyReservesViaApi', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          valid: true,
          mismatches: [],
        }),
      });
      global.fetch = mockFetch;

      const report = await verifyReservesViaApi(
        vectors.reserves_verification[0].declared,
        vectors.reserves_verification[0].observed,
      );
      expect(report.valid).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/stellar/reserves/verify',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });
});
