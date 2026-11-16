import {PriceData, ValuationResult, Rounding} from './types.js';
import {Spec, AssembledTransaction, Client as ContractClient, ClientOptions as ContractClientOptions, MethodOptions} from '@stellar/stellar-sdk/contract';
import {Address} from '@stellar/stellar-sdk';

export interface Client {
  /**
   * Return the administrator, if the contract has been initialized.
   */
  get_admin(options?: MethodOptions): Promise<AssembledTransaction<string | null>>;
  /**
   * Return the current price, falling back to the hardcoded rate if the
   * oracle data is stale or unavailable.
   */
  get_price(options?: MethodOptions): Promise<AssembledTransaction<PriceData>>;
  /**
   * Return the registered oracle address, if one has been set.
   */
  get_oracle(options?: MethodOptions): Promise<AssembledTransaction<string | null>>;
  /**
   * Set the contract administrator. Callable once.
   *
   * Without this, `set_oracle`'s `admin` parameter was self-asserted: the
   * caller passed whichever address they controlled, `require_auth()`
   * confirmed only that they controlled *that* address, and nothing tied it
   * to any privileged role. Anyone could re-point the oracle.
   */
  initialize({ admin }: { admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Register the address of the upstream oracle contract. Admin-only.
   */
  set_oracle({ admin, oracle }: { admin: string | Address; oracle: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Push a new price observation. Callable only by the registered oracle.
   */
  update_price({ caller, price_data }: { caller: string | Address; price_data: PriceData }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Convert a USD-denominated bounty amount to tokens at the current oracle
   * price, atomically at the moment of execution.
   *
   * - `usd_amount_micro`: The bounty value in micro-USD (e.g. $100 = 100_000_000).
   * - `decimals`: The number of decimal places of the token (e.g. 7 for Stellar assets in stroops).
   * - `rounding`: Explicit rounding direction (Rounding.Floor or Rounding.Ceil).
   */
  value_in_tokens({ usd_amount_micro, decimals, rounding }: { usd_amount_micro: bigint; decimals: number; rounding: Rounding }, options?: MethodOptions): Promise<AssembledTransaction<ValuationResult>>;
}

export class Client extends ContractClient {
  constructor(public readonly options: ContractClientOptions) {
    super(
      new Spec(["AAAAAQAAADNBIHNpbmdsZSBwcmljZSBvYnNlcnZhdGlvbiBmcm9tIHRoZSBvcmFjbGUgbmV0d29yay4AAAAAAAAAAAlQcmljZURhdGEAAAAAAAADAAAAREFzc2V0IHByaWNlIGluIG1pY3JvLVVTRCAoNiBkZWNpbWFsIHBsYWNlcywgZS5nLiAxIFVTRCA9IDFfMDAwXzAwMCkuAAAAD3ByaWNlX21pY3JvX3VzZAAAAAALAAAAM051bWJlciBvZiBvcmFjbGUgc291cmNlcyB0aGF0IGFncmVlZCBvbiB0aGlzIHByaWNlLgAAAAAHc291cmNlcwAAAAAEAAAALkxlZGdlciB0aW1lc3RhbXAgd2hlbiB0aGlzIHByaWNlIHdhcyByZWNvcmRlZC4AAAAAAAl0aW1lc3RhbXAAAAAAAAAG", "AAAAAwAAAVVSb3VuZGluZyBkaXJlY3Rpb24gZm9yIHRva2VuIHZhbHVhdGlvbi4KClVzZSBgRmxvb3JgIChyb3VuZCB0b3dhcmRzIHplcm8pIHdoZW4gdmFsdWluZyB1c2VyIHBheW91dHMgb3IgY29sbGF0ZXJhbCB3aXRoZHJhd2Fscwp0byBwcm90ZWN0IHRoZSBwcm90b2NvbCBwb29sIGZyb20gb3Zlci1kaXNidXJzaW5nIHRva2Vucy4KClVzZSBgQ2VpbGAgKHJvdW5kIGF3YXkgZnJvbSB6ZXJvKSB3aGVuIHZhbHVpbmcgcHJvdG9jb2wgZmVlcyBvciByZXF1aXJlZCBkZXBvc2l0IGFtb3VudHMKdG8gZ3VhcmFudGVlIHRoZSBwcm90b2NvbCByZWNlaXZlcyBhdCBsZWFzdCB0aGUgdGFyZ2V0ZWQgVVNEIHZhbHVlLgAAAAAAAAAAAAAIUm91bmRpbmcAAAACAAAAAAAAAAVGbG9vcgAAAAAAAAAAAAAAAAAABENlaWwAAAAB", "AAAABAAAACdFcnJvcnMgcmV0dXJuZWQgYnkgdGhlIG9yYWNsZSBjb250cmFjdC4AAAAAAAAAAAtPcmFjbGVFcnJvcgAAAAAFAAAAAAAAABRBbW91bnRNdXN0QmVQb3NpdGl2ZQAAAAEAAAAAAAAAEFByaWNlVW5hdmFpbGFibGUAAAACAAAAAAAAAA9JbnZhbGlkRGVjaW1hbHMAAAAAAwAAAAAAAAAIT3ZlcmZsb3cAAAAEAAAAAAAAAA5EaXZpc2lvbkJ5WmVybwAAAAAABQ==", "AAAAAQAAADBSZXN1bHQgb2YgYW4gYXRvbWljIHZhbHVhdGlvbiBhdCBleGVjdXRpb24gdGltZS4AAAAAAAAAD1ZhbHVhdGlvblJlc3VsdAAAAAAGAAAAJ1Rva2VuIGRlY2ltYWxzIHVzZWQgZm9yIHRoZSBjb252ZXJzaW9uLgAAAAAIZGVjaW1hbHMAAAAEAAAAOlByaWNlIHVzZWQgZm9yIHRoZSBjb252ZXJzaW9uIChtaWNyby1VU0QgcGVyIHdob2xlIHRva2VuKS4AAAAAAApwcmljZV91c2VkAAAAAAALAAAALFJvdW5kaW5nIGRpcmVjdGlvbiBhcHBsaWVkIGR1cmluZyB2YWx1YXRpb24uAAAACHJvdW5kaW5nAAAH0AAAAAhSb3VuZGluZwAAAGZFcXVpdmFsZW50IHRva2VuIGFtb3VudCBhdCB0aGUgbG9ja2VkLWluIHByaWNlLCBpbiBzbWFsbGVzdCB0b2tlbiB1bml0cyAoZS5nLiBzdHJvb3BzIGZvciA3IGRlY2ltYWxzKS4AAAAAAAx0b2tlbl9hbW91bnQAAAALAAAAOlVTRCBhbW91bnQgcmVxdWVzdGVkIChtaWNyby1VU0QsIGUuZy4gJDEwMCA9IDEwMF8wMDBfMDAwKS4AAAAAABB1c2RfYW1vdW50X21pY3JvAAAACwAAAF9XaGV0aGVyIHRoZSBmYWxsYmFjayBwcmljZSB3YXMgdXNlZCBpbnN0ZWFkIG9mIHRoZSBsaXZlIG9yYWNsZSBwcmljZSAoYWx3YXlzIGZhbHNlIG9uIHN1Y2Nlc3MpLgAAAAANdXNlZF9mYWxsYmFjawAAAAAAAAE=", "AAAAAAAAAD9SZXR1cm4gdGhlIGFkbWluaXN0cmF0b3IsIGlmIHRoZSBjb250cmFjdCBoYXMgYmVlbiBpbml0aWFsaXplZC4AAAAACWdldF9hZG1pbgAAAAAAAAAAAAABAAAD6AAAABM=", "AAAAAAAAAGhSZXR1cm4gdGhlIGN1cnJlbnQgcHJpY2UsIGZhbGxpbmcgYmFjayB0byB0aGUgaGFyZGNvZGVkIHJhdGUgaWYgdGhlCm9yYWNsZSBkYXRhIGlzIHN0YWxlIG9yIHVuYXZhaWxhYmxlLgAAAAlnZXRfcHJpY2UAAAAAAAAAAAAAAQAAB9AAAAAJUHJpY2VEYXRhAAAA", "AAAAAAAAADpSZXR1cm4gdGhlIHJlZ2lzdGVyZWQgb3JhY2xlIGFkZHJlc3MsIGlmIG9uZSBoYXMgYmVlbiBzZXQuAAAAAAAKZ2V0X29yYWNsZQAAAAAAAAAAAAEAAAPoAAAAEw==", "AAAAAAAAATlTZXQgdGhlIGNvbnRyYWN0IGFkbWluaXN0cmF0b3IuIENhbGxhYmxlIG9uY2UuCgpXaXRob3V0IHRoaXMsIGBzZXRfb3JhY2xlYCdzIGBhZG1pbmAgcGFyYW1ldGVyIHdhcyBzZWxmLWFzc2VydGVkOiB0aGUKY2FsbGVyIHBhc3NlZCB3aGljaGV2ZXIgYWRkcmVzcyB0aGV5IGNvbnRyb2xsZWQsIGByZXF1aXJlX2F1dGgoKWAKY29uZmlybWVkIG9ubHkgdGhhdCB0aGV5IGNvbnRyb2xsZWQgKnRoYXQqIGFkZHJlc3MsIGFuZCBub3RoaW5nIHRpZWQgaXQKdG8gYW55IHByaXZpbGVnZWQgcm9sZS4gQW55b25lIGNvdWxkIHJlLXBvaW50IHRoZSBvcmFjbGUuAAAAAAAACmluaXRpYWxpemUAAAAAAAEAAAAAAAAABWFkbWluAAAAAAAAEwAAAAA=", "AAAAAAAAAEFSZWdpc3RlciB0aGUgYWRkcmVzcyBvZiB0aGUgdXBzdHJlYW0gb3JhY2xlIGNvbnRyYWN0LiBBZG1pbi1vbmx5LgAAAAAAAApzZXRfb3JhY2xlAAAAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAABm9yYWNsZQAAAAAAEwAAAAA=", "AAAAAAAAAEVQdXNoIGEgbmV3IHByaWNlIG9ic2VydmF0aW9uLiBDYWxsYWJsZSBvbmx5IGJ5IHRoZSByZWdpc3RlcmVkIG9yYWNsZS4AAAAAAAAMdXBkYXRlX3ByaWNlAAAAAgAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAApwcmljZV9kYXRhAAAAAAfQAAAACVByaWNlRGF0YQAAAAAAAAA=", "AAAAAAAAAtlDb252ZXJ0IGEgVVNELWRlbm9taW5hdGVkIGJvdW50eSBhbW91bnQgdG8gdG9rZW5zIGF0IHRoZSBjdXJyZW50IG9yYWNsZQpwcmljZSwgYXRvbWljYWxseSBhdCB0aGUgbW9tZW50IG9mIGV4ZWN1dGlvbi4KCi0gYHVzZF9hbW91bnRfbWljcm9gOiBUaGUgYm91bnR5IHZhbHVlIGluIG1pY3JvLVVTRCAoZS5nLiAkMTAwID0gMTAwXzAwMF8wMDApLgotIGBkZWNpbWFsc2A6IFRoZSBudW1iZXIgb2YgZGVjaW1hbCBwbGFjZXMgb2YgdGhlIHRva2VuIChlLmcuIDcgZm9yIFN0ZWxsYXIgYXNzZXRzIGluIHN0cm9vcHMsIHVwIHRvIDE4KS4KLSBgcm91bmRpbmdgOiBFeHBsaWNpdCByb3VuZGluZyBkaXJlY3Rpb246Ci0gYFJvdW5kaW5nOjpGbG9vcmAgKHRvd2FyZHMgemVybyk6IFJlY29tbWVuZGVkIGZvciB1c2VyIHBheW91dHMgYW5kIGNvbGxhdGVyYWwgY2xhaW1zIHRvIHByZXZlbnQgb3Zlci1kaXNidXJzaW5nIHRva2Vucy4KLSBgUm91bmRpbmc6OkNlaWxgIChhd2F5IGZyb20gemVybyk6IFJlY29tbWVuZGVkIGZvciBwcm90b2NvbCBmZWVzIGFuZCByZXF1aXJlZCBkZXBvc2l0cyB0byBlbnN1cmUgZnVsbCBVU0QgY292ZXJhZ2UuCgpSZXR1cm5zIGBFcnIoT3JhY2xlRXJyb3I6OlByaWNlVW5hdmFpbGFibGUpYCBpZiBsaXZlIG9yYWNsZSBkYXRhIGlzIHN0YWxlIG9yIGFic2VudAoocmVmdXNpbmcgc2lsZW50IGNvbnZlcnNpb25zIGFnYWluc3QgZmFsbGJhY2sgY29uc3RhbnRzKS4AAAAAAAAPdmFsdWVfaW5fdG9rZW5zAAAAAAMAAAAAAAAAEHVzZF9hbW91bnRfbWljcm8AAAALAAAAAAAAAAhkZWNpbWFscwAAAAQAAAAAAAAACHJvdW5kaW5nAAAH0AAAAAhSb3VuZGluZwAAAAEAAAPpAAAH0AAAAA9WYWx1YXRpb25SZXN1bHQAAAAH0AAAAAtPcmFjbGVFcnJvcgA="]),
      options
    );
  }

   static deploy<T = Client>(options: MethodOptions & Omit<ContractClientOptions, 'contractId'> & { wasmHash: Buffer | string; salt?: Buffer | Uint8Array; format?: "hex" | "base64"; address?: string; }): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options);
  }
  public readonly fromJSON = {
    get_admin : this.txFromJSON<string | null>,  get_price : this.txFromJSON<PriceData>,  get_oracle : this.txFromJSON<string | null>,  initialize : this.txFromJSON<void>,  set_oracle : this.txFromJSON<void>,  update_price : this.txFromJSON<void>,  value_in_tokens : this.txFromJSON<ValuationResult>
  };

}
