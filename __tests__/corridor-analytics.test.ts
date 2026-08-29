import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseStroops,
  parsePathPaymentOperation,
  fetchPathPaymentOperations,
  type HorizonOperationRecord,
} from '@/backend/services/corridor-analytics';
import recordedFixture from './fixtures/horizon-path-payments.json';

describe('Corridor Analytics Service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('parseStroops', () => {
    it('accurately parses decimal strings to 7-decimal stroops BigInt', () => {
      expect(parseStroops('1.0000000')).toBe(10_000_000n);
      expect(parseStroops('5.7549696')).toBe(57_549_696n);
      expect(parseStroops('0.0000001')).toBe(1n);
      expect(parseStroops('100')).toBe(1_000_000_000n);
      expect(parseStroops('0.5')).toBe(5_000_000n);
    });

    it('handles numeric inputs without precision loss', () => {
      expect(parseStroops(10)).toBe(100_000_000n);
      expect(parseStroops(0.1)).toBe(1_000_000n);
    });
  });

  describe('parsePathPaymentOperation', () => {
    it('parses path_payment_strict_send with credit and native assets', () => {
      const record = recordedFixture._embedded.records[0] as unknown as HorizonOperationRecord;
      const event = parsePathPaymentOperation(record);

      expect(event).not.toBeNull();
      expect(event?.sourceCurrency).toBe('yXLM');
      expect(event?.destCurrency).toBe('XLM');
      expect(event?.amount).toBe(57_549_696n);
      expect(event?.timestamp.toISOString()).toBe('2026-08-29T13:39:27.000Z');
    });

    it('parses path_payment_strict_receive with credit and native assets', () => {
      const record = recordedFixture._embedded.records[1] as unknown as HorizonOperationRecord;
      const event = parsePathPaymentOperation(record);

      expect(event).not.toBeNull();
      expect(event?.sourceCurrency).toBe('yXLM');
      expect(event?.destCurrency).toBe('XLM');
      expect(event?.amount).toBe(245_557_509n);
      expect(event?.timestamp.toISOString()).toBe('2026-08-29T13:39:40.000Z');
    });

    it('parses path_payment_strict_send with native source asset and credit destination asset', () => {
      const record = recordedFixture._embedded.records[2] as unknown as HorizonOperationRecord;
      const event = parsePathPaymentOperation(record);

      expect(event).not.toBeNull();
      expect(event?.sourceCurrency).toBe('XLM');
      expect(event?.destCurrency).toBe('USDC');
      expect(event?.amount).toBe(1_000_000_000n);
      expect(event?.timestamp.toISOString()).toBe('2026-08-29T13:35:00.000Z');
    });

    it('returns null for failed transactions', () => {
      const failedRecord = recordedFixture._embedded.records[3] as unknown as HorizonOperationRecord;
      const event = parsePathPaymentOperation(failedRecord);
      expect(event).toBeNull();
    });

    it('returns null for non-path-payment operations', () => {
      const paymentRecord = recordedFixture._embedded.records[4] as unknown as HorizonOperationRecord;
      const event = parsePathPaymentOperation(paymentRecord);
      expect(event).toBeNull();
    });
  });

  describe('fetchPathPaymentOperations with recorded fixture', () => {
    it('fetches and maps recorded operations without network calls', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => recordedFixture,
      } as Response);

      const events = await fetchPathPaymentOperations(undefined, 'https://mock-horizon.stellar.org');

      // The fixture has 5 records: 2 strict send, 1 strict receive, 1 failed, 1 standard payment
      // Only the 3 successful path payments should be mapped
      expect(events).toHaveLength(3);
      expect(events[0]).toMatchObject({
        sourceCurrency: 'yXLM',
        destCurrency: 'XLM',
        amount: 57_549_696n,
      });
      expect(events[1]).toMatchObject({
        sourceCurrency: 'yXLM',
        destCurrency: 'XLM',
        amount: 245_557_509n,
      });
      expect(events[2]).toMatchObject({
        sourceCurrency: 'XLM',
        destCurrency: 'USDC',
        amount: 1_000_000_000n,
      });
    });

    it('filters operations based on since timestamp', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => recordedFixture,
      } as Response);

      // Record 2 is at 13:35:00Z, Record 0 is at 13:39:27Z, Record 1 is at 13:39:40Z
      // Filter since 13:38:00Z (Unix timestamp 1787998680)
      const since = Math.floor(new Date('2026-08-29T13:38:00Z').getTime() / 1000);
      const events = await fetchPathPaymentOperations(since, 'https://mock-horizon.stellar.org');

      expect(events).toHaveLength(2);
      expect(events.map((e) => e.sourceCurrency)).toEqual(['yXLM', 'yXLM']);
    });

    it('returns an empty array when Horizon returns an error status', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      } as Response);

      const events = await fetchPathPaymentOperations(undefined, 'https://mock-horizon.stellar.org');
      expect(events).toEqual([]);
    });

    it('returns an empty array when fetch rejects', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));

      const events = await fetchPathPaymentOperations(undefined, 'https://mock-horizon.stellar.org');
      expect(events).toEqual([]);
    });
  });
});
