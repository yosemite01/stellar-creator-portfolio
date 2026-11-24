import {PriceData, RoundingMode, ValuationResult} from './types';
import {Spec, AssembledTransaction, Client as ContractClient, ClientOptions as ContractClientOptions, MethodOptions} from '@stellar/stellar-sdk/contract';
import {Address} from '@stellar/stellar-sdk';

export interface Client {
  /**
   * Return the administrator, if the contract has been initialized.
   */
  get_admin(options?: MethodOptions): Promise<AssembledTransaction<string | null>>;
  /**
   * Return the current price, or an error when no fresh price is available.
   * Never returns a hardcoded fallback.
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
   * Convert a USD-denominated amount to the token's smallest unit (stroops)
   * at the current oracle price, atomically at execution time.
   *
   * - `usd_amount_micro` – the value in micro-USD (1 USD = 1_000_000).
   * - `token_decimals`   – decimal places of the target token (7 for XLM, 6 for USDC).
   * - `rounding`         – `Up` favours the protocol (fees); `Down` favours the user (payouts).
   *
   * Returns an error when no fresh price is available. Callers must revert on error —
   * never use a stale or guessed rate for value transfer.
   *
   * ### Breaking change from pre-1829
   * `token_amount` is now in the token's **smallest unit** (stroops), not whole tokens.
   * For XLM (7 decimals) divide by `10^7` to recover whole tokens.
   */
  value_in_tokens(
    { usd_amount_micro, token_decimals, rounding }: {
      usd_amount_micro: bigint;
      token_decimals: number;
      rounding: RoundingMode;
    },
    options?: MethodOptions
  ): Promise<AssembledTransaction<ValuationResult>>;
}

export class Client extends ContractClient {
  constructor(public readonly options: ContractClientOptions) {
    super(
      // NOTE: The XDR spec below must be regenerated after deploying the updated
      // contract (`stellar contract bindings typescript …`). The spec here reflects
      // the pre-1829 ABI and will be replaced in a follow-up deployment step.
      // The TypeScript interface above already matches the new Rust ABI.
      new Spec(["AAAAAQAAADNBIHNpbmdsZSBwcmljZSBvYnNlcnZhdGlvbiBmcm9tIHRoZSBvcmFjbGUgbmV0d29yay4AAAAAAAAAAAlQcmljZURhdGEAAAAAAAADAAAAREFzc2V0IHByaWNlIGluIG1pY3JvLVVTRCAoNiBkZWNpbWFsIHBsYWNlcywgZS5nLiAxIFVTRCA9IDFfMDAwXzAwMCkuAAAAD3ByaWNlX21pY3JvX3VzZAAAAAAACwAAADNOdW1iZXIgb2Ygb3JhY2xlIHNvdXJjZXMgdGhhdCBhZ3JlZWQgb24gdGhpcyBwcmljZS4AAAAAHHNvdXJjZXMAAAAEAAAALkxlZGdlciB0aW1lc3RhbXAgd2hlbiB0aGlzIHByaWNlIHdhcyByZWNvcmRlZC4AAAAAAAl0aW1lc3RhbXAAAAAAAAAG", "AAAAAQAAADBSZXN1bHQgb2YgYW4gYXRvbWljIHZhbHVhdGlvbiBhdCBleGVjdXRpb24gdGltZS4AAAAAAAAAD1ZhbHVhdGlvblJlc3VsdAAAAAAFAAAANFByaWNlIHVzZWQgZm9yIHRoZSBjb252ZXJzaW9uIChtaWNyby1VU0QgcGVyIHRva2VuKS4AAAAKcHJpY2VfdXNlZAAAAAAACwAAAFhFcXVpdmFsZW50IHRva2VuIGFtb3VudCBleHByZXNzZWQgaW4gdGhlIHRva2VuJ3Mgc21hbGxlc3QgdW5pdCAoMTBedG9rZW5fZGVjaW1hbHMgcGVyIHdob2xlIHRva2VuKS4AAAAADHRva2VuX2Ftb3VudAAAAAsAAAA6RGVjaW1hbCBwbGFjZXMgb2YgdGhlIHRva2VuIChlLmcuIDcgZm9yIFhMTSwgNiBmb3IgVVNEQykuAAAAAAAOdG9rZW5fZGVjaW1hbHMAAAAAAAQAAAAhVVNEIGFtb3VudCByZXF1ZXN0ZWQgKG1pY3JvLVVTRCkuAAAAAAAAEHVzZF9hbW91bnRfbWljcm8AAAALAAAARVdoZXRoZXIgdGhlIHNlY29uZGFyeSAoUmVmbGVjdG9yKSBzb3VyY2Ugc3VwcGxpZWQgdGhlIHByaWNlLgAAAAAAAA11c2VkX2ZhbGxiYWNrAAAAAAAAAQ==", "AAAAAAAAAD9SZXR1cm4gdGhlIGFkbWluaXN0cmF0b3IsIGlmIHRoZSBjb250cmFjdCBoYXMgYmVlbiBpbml0aWFsaXplZC4AAAAACWdldF9hZG1pbgAAAAAAAAAAAAABAAAD6AAAABM=", "AAAAAAAAAEhSZXR1cm4gdGhlIGN1cnJlbnQgcHJpY2UsIG9yIGFuIGVycm9yIHdoZW4gbm8gZnJlc2ggcHJpY2UgaXMgYXZhaWxhYmxlLgAAAAlnZXRfcHJpY2UAAAAAAAAAAAAAAQAAB9AAAAAJUHJpY2VEYXRhAAAA", "AAAAAAAAADpSZXR1cm4gdGhlIHJlZ2lzdGVyZWQgb3JhY2xlIGFkZHJlc3MsIGlmIG9uZSBoYXMgYmVlbiBzZXQuAAAAAAAKZ2V0X29yYWNsZQAAAAAAAAAAAAEAAAPoAAAAEw==", "AAAAAAAAATlTZXQgdGhlIGNvbnRyYWN0IGFkbWluaXN0cmF0b3IuIENhbGxhYmxlIG9uY2UuCgpXaXRob3V0IHRoaXMsIGBzZXRfb3JhY2xlYCdzIGBhZG1pbmAgcGFyYW1ldGVyIHdhcyBzZWxmLWFzc2VydGVkOiB0aGUKY2FsbGVyIHBhc3NlZCB3aGljaGV2ZXIgYWRkcmVzcyB0aGV5IGNvbnRyb2xsZWQsIGByZXF1aXJlX2F1dGgoKWAKY29uZmlybWVkIG9ubHkgdGhhdCB0aGV5IGNvbnRyb2xsZWQgKnRoYXQqIGFkZHJlc3MsIGFuZCBub3RoaW5nIHRpZWQgaXQKdG8gYW55IHByaXZpbGVnZWQgcm9sZS4gQW55b25lIGNvdWxkIHJlLXBvaW50IHRoZSBvcmFjbGUuAAAAAAAACmluaXRpYWxpemUAAAAAAAEAAAAAAAAABWFkbWluAAAAAAAAEwAAAAA=", "AAAAAAAAAEFSZWdpc3RlciB0aGUgYWRkcmVzcyBvZiB0aGUgdXBzdHJlYW0gb3JhY2xlIGNvbnRyYWN0LiBBZG1pbi1vbmx5LgAAAAAAAApzZXRfb3JhY2xlAAAAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAABm9yYWNsZQAAAAAAEwAAAAA=", "AAAAAAAAAEVQdXNoIGEgbmV3IHByaWNlIG9ic2VydmF0aW9uLiBDYWxsYWJsZSBvbmx5IGJ5IHRoZSByZWdpc3RlcmVkIG9yYWNsZS4AAAAAAAAMdXBkYXRlX3ByaWNlAAAAAgAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAApwcmljZV9kYXRhAAAAAAfQAAAACVByaWNlRGF0YQAAAAAAAAA="]),
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
