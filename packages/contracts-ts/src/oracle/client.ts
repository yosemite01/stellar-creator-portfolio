import {PriceData, ValuationResult} from './types';
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
   * `usd_amount_micro` – the bounty value in micro-USD (e.g. $100 = 100_000_000).
   */
  value_in_tokens({ usd_amount_micro }: { usd_amount_micro: bigint }, options?: MethodOptions): Promise<AssembledTransaction<ValuationResult>>;
}

export class Client extends ContractClient {
  constructor(public readonly options: ContractClientOptions) {
    super(
      new Spec(["AAAAAQAAADNBIHNpbmdsZSBwcmljZSBvYnNlcnZhdGlvbiBmcm9tIHRoZSBvcmFjbGUgbmV0d29yay4AAAAAAAAAAAlQcmljZURhdGEAAAAAAAADAAAAREFzc2V0IHByaWNlIGluIG1pY3JvLVVTRCAoNiBkZWNpbWFsIHBsYWNlcywgZS5nLiAxIFVTRCA9IDFfMDAwXzAwMCkuAAAAD3ByaWNlX21pY3JvX3VzZAAAAAALAAAAM051bWJlciBvZiBvcmFjbGUgc291cmNlcyB0aGF0IGFncmVlZCBvbiB0aGlzIHByaWNlLgAAAAAHc291cmNlcwAAAAAEAAAALkxlZGdlciB0aW1lc3RhbXAgd2hlbiB0aGlzIHByaWNlIHdhcyByZWNvcmRlZC4AAAAAAAl0aW1lc3RhbXAAAAAAAAAG", "AAAAAQAAADBSZXN1bHQgb2YgYW4gYXRvbWljIHZhbHVhdGlvbiBhdCBleGVjdXRpb24gdGltZS4AAAAAAAAAD1ZhbHVhdGlvblJlc3VsdAAAAAAEAAAANFByaWNlIHVzZWQgZm9yIHRoZSBjb252ZXJzaW9uIChtaWNyby1VU0QgcGVyIHRva2VuKS4AAAAKcHJpY2VfdXNlZAAAAAAACwAAAC9FcXVpdmFsZW50IHRva2VuIGFtb3VudCBhdCB0aGUgbG9ja2VkLWluIHByaWNlLgAAAAAMdG9rZW5fYW1vdW50AAAACwAAACFVU0QgYW1vdW50IHJlcXVlc3RlZCAobWljcm8tVVNEKS4AAAAAAAAQdXNkX2Ftb3VudF9taWNybwAAAAsAAABFV2hldGhlciB0aGUgZmFsbGJhY2sgcHJpY2Ugd2FzIHVzZWQgaW5zdGVhZCBvZiB0aGUgbGl2ZSBvcmFjbGUgcHJpY2UuAAAAAAAADXVzZWRfZmFsbGJhY2sAAAAAAAAB", "AAAAAAAAAD9SZXR1cm4gdGhlIGFkbWluaXN0cmF0b3IsIGlmIHRoZSBjb250cmFjdCBoYXMgYmVlbiBpbml0aWFsaXplZC4AAAAACWdldF9hZG1pbgAAAAAAAAAAAAABAAAD6AAAABM=", "AAAAAAAAAGhSZXR1cm4gdGhlIGN1cnJlbnQgcHJpY2UsIGZhbGxpbmcgYmFjayB0byB0aGUgaGFyZGNvZGVkIHJhdGUgaWYgdGhlCm9yYWNsZSBkYXRhIGlzIHN0YWxlIG9yIHVuYXZhaWxhYmxlLgAAAAlnZXRfcHJpY2UAAAAAAAAAAAAAAQAAB9AAAAAJUHJpY2VEYXRhAAAA", "AAAAAAAAADpSZXR1cm4gdGhlIHJlZ2lzdGVyZWQgb3JhY2xlIGFkZHJlc3MsIGlmIG9uZSBoYXMgYmVlbiBzZXQuAAAAAAAKZ2V0X29yYWNsZQAAAAAAAAAAAAEAAAPoAAAAEw==", "AAAAAAAAATlTZXQgdGhlIGNvbnRyYWN0IGFkbWluaXN0cmF0b3IuIENhbGxhYmxlIG9uY2UuCgpXaXRob3V0IHRoaXMsIGBzZXRfb3JhY2xlYCdzIGBhZG1pbmAgcGFyYW1ldGVyIHdhcyBzZWxmLWFzc2VydGVkOiB0aGUKY2FsbGVyIHBhc3NlZCB3aGljaGV2ZXIgYWRkcmVzcyB0aGV5IGNvbnRyb2xsZWQsIGByZXF1aXJlX2F1dGgoKWAKY29uZmlybWVkIG9ubHkgdGhhdCB0aGV5IGNvbnRyb2xsZWQgKnRoYXQqIGFkZHJlc3MsIGFuZCBub3RoaW5nIHRpZWQgaXQKdG8gYW55IHByaXZpbGVnZWQgcm9sZS4gQW55b25lIGNvdWxkIHJlLXBvaW50IHRoZSBvcmFjbGUuAAAAAAAACmluaXRpYWxpemUAAAAAAAEAAAAAAAAABWFkbWluAAAAAAAAEwAAAAA=", "AAAAAAAAAEFSZWdpc3RlciB0aGUgYWRkcmVzcyBvZiB0aGUgdXBzdHJlYW0gb3JhY2xlIGNvbnRyYWN0LiBBZG1pbi1vbmx5LgAAAAAAAApzZXRfb3JhY2xlAAAAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAABm9yYWNsZQAAAAAAEwAAAAA=", "AAAAAAAAAEVQdXNoIGEgbmV3IHByaWNlIG9ic2VydmF0aW9uLiBDYWxsYWJsZSBvbmx5IGJ5IHRoZSByZWdpc3RlcmVkIG9yYWNsZS4AAAAAAAAMdXBkYXRlX3ByaWNlAAAAAgAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAApwcmljZV9kYXRhAAAAAAfQAAAACVByaWNlRGF0YQAAAAAAAAA=", "AAAAAAAAAMZDb252ZXJ0IGEgVVNELWRlbm9taW5hdGVkIGJvdW50eSBhbW91bnQgdG8gdG9rZW5zIGF0IHRoZSBjdXJyZW50IG9yYWNsZQpwcmljZSwgYXRvbWljYWxseSBhdCB0aGUgbW9tZW50IG9mIGV4ZWN1dGlvbi4KCmB1c2RfYW1vdW50X21pY3JvYCDigJMgdGhlIGJvdW50eSB2YWx1ZSBpbiBtaWNyby1VU0QgKGUuZy4gJDEwMCA9IDEwMF8wMDBfMDAwKS4AAAAAAA92YWx1ZV9pbl90b2tlbnMAAAAAAQAAAAAAAAAQdXNkX2Ftb3VudF9taWNybwAAAAsAAAABAAAH0AAAAA9WYWx1YXRpb25SZXN1bHQA"]),
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