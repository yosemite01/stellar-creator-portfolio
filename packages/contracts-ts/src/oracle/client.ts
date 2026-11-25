import {PriceData, OracleError, ReflectorConfig, Asset, ValuationResult, PendingUpgrade, PriceView} from './types';
import {Result, Spec, AssembledTransaction, Client as ContractClient, ClientOptions as ContractClientOptions, MethodOptions} from '@stellar/stellar-sdk/contract';
import {Address} from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';

export interface Client {
  /**
   * Return the administrator, if the contract has been initialized.
   */
  get_admin(options?: MethodOptions): Promise<AssembledTransaction<string | null>>;
  /**
   * Return the current price, or an error when no fresh price is available.
   *
   * Never returns a hardcoded fallback. A contract that invokes this across
   * contracts reverts when it returns `Err`, which is the intended outcome
   * for payouts and fee conversions during an oracle outage.
   */
  get_price(options?: MethodOptions): Promise<AssembledTransaction<Result<PriceData, OracleError>>>;
  /**
   * Return the registered oracle address, if one has been set.
   */
  get_oracle(options?: MethodOptions): Promise<AssembledTransaction<string | null>>;
  get_quorum(options?: MethodOptions): Promise<AssembledTransaction<number>>;
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
   * Set the minimum number of fresh reports required for a median price.
   * `0` disables reporter aggregation. Admin-only. Emits `(oracle, quorum_set)`.
   */
  set_quorum({ admin, quorum }: { admin: string | Address; quorum: number }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Accept a nomination (step 2 of 2). Must be signed by the nominee.
   * Emits `(admin, accepted)`.
   */
  accept_admin({ new_admin }: { new_admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Authorise a price reporter. Admin-only. Emits `(oracle, rep_added)`.
   */
  add_reporter({ admin, reporter }: { admin: string | Address; reporter: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Push a new price observation. Callable only by the registered oracle.
   */
  update_price({ caller, price_data }: { caller: string | Address; price_data: PriceData }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  get_reflector(options?: MethodOptions): Promise<AssembledTransaction<ReflectorConfig | null>>;
  get_reporters(options?: MethodOptions): Promise<AssembledTransaction<Array<string>>>;
  /**
   * Nominate a new admin (step 1 of 2). Admin-only. Emits `(admin, proposed)`.
   */
  propose_admin({ admin, new_admin }: { admin: string | Address; new_admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Configure the Reflector (SEP-40) contract used as secondary source.
   * Admin-only. Emits `(oracle, reflector_set)`.
   */
  set_reflector({ admin, contract, asset }: { admin: string | Address; contract: string | Address; asset: Asset }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Submit a price report. Callable only by an authorised reporter.
   * The report is timestamped with the current ledger time.
   * Emits `(oracle, reported)`.
   */
  submit_report({ reporter, price_micro_usd }: { reporter: string | Address; price_micro_usd: bigint }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Withdraw the pending upgrade. Admin-only. Emits `(upgrade, cancelled)`.
   */
  cancel_upgrade({ admin }: { admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Remove the secondary source. Admin-only. Emits `(oracle, reflector_clr)`.
   */
  clear_reflector({ admin }: { admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Apply the pending upgrade once its timelock has elapsed. Admin-only.
   * Emits `(contract, upgraded)`.
   */
  execute_upgrade({ admin }: { admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Propose a WASM upgrade. Admin-only. Returns the ledger timestamp after
   * which `execute_upgrade` may be called (now + 48h). Emits
   * `(upgrade, proposed)`.
   */
  propose_upgrade({ admin, new_wasm_hash }: { admin: string | Address; new_wasm_hash: Buffer }, options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  /**
   * Revoke a price reporter and drop its last report. Admin-only.
   * Fails if the removal would leave fewer reporters than the quorum.
   * Emits `(oracle, rep_removed)`.
   */
  remove_reporter({ admin, reporter }: { admin: string | Address; reporter: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Convert a USD-denominated bounty amount to tokens at the current oracle
   * price, atomically at the moment of execution.
   *
   * `usd_amount_micro` – the bounty value in micro-USD (e.g. $100 = 100_000_000).
   *
   * Returns `Err(OracleError::Stale | NoPrice)` rather than converting at a
   * made-up rate.
   */
  value_in_tokens({ usd_amount_micro }: { usd_amount_micro: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<ValuationResult, OracleError>>>;
  /**
   * The nominated-but-not-yet-accepted admin, if any.
   */
  get_pending_admin(options?: MethodOptions): Promise<AssembledTransaction<string | null>>;
  /**
   * The upgrade currently waiting out its timelock, if any.
   */
  get_pending_upgrade(options?: MethodOptions): Promise<AssembledTransaction<PendingUpgrade | null>>;
  /**
   * Return the best known price for UI display, flagged when stale.
   *
   * Must not be used for value transfer: use `get_price` / `value_in_tokens`.
   */
  get_price_unchecked(options?: MethodOptions): Promise<AssembledTransaction<PriceView | null>>;
  /**
   * Withdraw a pending admin nomination. Admin-only. Emits `(admin, cancelled)`.
   */
  cancel_admin_transfer({ admin }: { admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
}

export class Client extends ContractClient {
  constructor(public readonly options: ContractClientOptions) {
    super(
      new Spec(["AAAAAgAAACRSZWZsZWN0b3IgKFNFUC00MCkgYXNzZXQgaWRlbnRpZmllci4AAAAAAAAABUFzc2V0AAAAAAAAAgAAAAEAAAAAAAAAB1N0ZWxsYXIAAAAAAQAAABMAAAABAAAAAAAAAAVPdGhlcgAAAAAAAAEAAAAR", "AAAAAQAAADNBIHNpbmdsZSBwcmljZSBvYnNlcnZhdGlvbiBmcm9tIHRoZSBvcmFjbGUgbmV0d29yay4AAAAAAAAAAAlQcmljZURhdGEAAAAAAAADAAAAREFzc2V0IHByaWNlIGluIG1pY3JvLVVTRCAoNiBkZWNpbWFsIHBsYWNlcywgZS5nLiAxIFVTRCA9IDFfMDAwXzAwMCkuAAAAD3ByaWNlX21pY3JvX3VzZAAAAAALAAAAM051bWJlciBvZiBvcmFjbGUgc291cmNlcyB0aGF0IGFncmVlZCBvbiB0aGlzIHByaWNlLgAAAAAHc291cmNlcwAAAAAEAAAALkxlZGdlciB0aW1lc3RhbXAgd2hlbiB0aGlzIHByaWNlIHdhcyByZWNvcmRlZC4AAAAAAAl0aW1lc3RhbXAAAAAAAAAG", "AAAAAQAAAE1QcmljZSBmb3IgZGlzcGxheSBwdXJwb3NlcywgcmV0dXJuZWQgZXZlbiB3aGVuIHN0YWxlIChgZ2V0X3ByaWNlX3VuY2hlY2tlZGApLgAAAAAAAAAAAAAJUHJpY2VWaWV3AAAAAAAAAgAAAF5gdHJ1ZWAgd2hlbiB0aGUgcHJpY2UgaXMgb2xkZXIgdGhhbiBgTUFYX1BSSUNFX0FHRV9TRUNTYCBhbmQgd291bGQgYmUKcmVqZWN0ZWQgYnkgYGdldF9wcmljZWAuAAAAAAAIaXNfc3RhbGUAAAABAAAAAAAAAAVwcmljZQAAAAAAB9AAAAAJUHJpY2VEYXRhAAAA", "AAAABAAAAHdUeXBlZCBlcnJvcnMgcmV0dXJuZWQgYnkgdGhlIHByaWNlIHJlYWQgcGF0aHMuCgpDb2RlcyBhcmUgcGFydCBvZiB0aGUgcHVibGljIGludGVyZmFjZSDigJQgYXBwZW5kIG9ubHksIG5ldmVyIHJlbnVtYmVyLgAAAAAAAAAAC09yYWNsZUVycm9yAAAAAAIAAAB9UHJpY2UgZGF0YSBleGlzdHMgYnV0IG5vbmUgb2YgaXQgaXMgeW91bmdlciB0aGFuIGBNQVhfUFJJQ0VfQUdFX1NFQ1NgCihvciB0aGUgcmVwb3J0ZXIgcXVvcnVtIGlzIG5vdCBtZXQgd2l0aCBmcmVzaCByZXBvcnRzKS4AAAAAAAAFU3RhbGUAAAAAAAABAAAAME5vIHByaWNlIGhhcyBldmVyIGJlZW4gcmVjb3JkZWQgZnJvbSBhbnkgc291cmNlLgAAAAdOb1ByaWNlAAAAAAI=", "AAAAAQAAAB9TZWNvbmRhcnktc291cmNlIGNvbmZpZ3VyYXRpb24uAAAAAAAAAAAPUmVmbGVjdG9yQ29uZmlnAAAAAAIAAAAAAAAABWFzc2V0AAAAAAAH0AAAAAVBc3NldAAAAAAAAAAAAAAIY29udHJhY3QAAAAT", "AAAAAQAAADBSZXN1bHQgb2YgYW4gYXRvbWljIHZhbHVhdGlvbiBhdCBleGVjdXRpb24gdGltZS4AAAAAAAAAD1ZhbHVhdGlvblJlc3VsdAAAAAAEAAAANFByaWNlIHVzZWQgZm9yIHRoZSBjb252ZXJzaW9uIChtaWNyby1VU0QgcGVyIHRva2VuKS4AAAAKcHJpY2VfdXNlZAAAAAAACwAAAC9FcXVpdmFsZW50IHRva2VuIGFtb3VudCBhdCB0aGUgbG9ja2VkLWluIHByaWNlLgAAAAAMdG9rZW5fYW1vdW50AAAACwAAACFVU0QgYW1vdW50IHJlcXVlc3RlZCAobWljcm8tVVNEKS4AAAAAAAAQdXNkX2Ftb3VudF9taWNybwAAAAsAAACJV2hldGhlciB0aGUgc2Vjb25kYXJ5IChSZWZsZWN0b3IpIHNvdXJjZSBzdXBwbGllZCB0aGUgcHJpY2UgaW5zdGVhZCBvZgp0aGUgcHJpbWFyeSByZXBvcnRlcnMgLyByZWdpc3RlcmVkIG9yYWNsZS4gTmV2ZXIgYSBoYXJkY29kZWQgcmF0ZS4AAAAAAAANdXNlZF9mYWxsYmFjawAAAAAAAAE=", "AAAAAAAAAD9SZXR1cm4gdGhlIGFkbWluaXN0cmF0b3IsIGlmIHRoZSBjb250cmFjdCBoYXMgYmVlbiBpbml0aWFsaXplZC4AAAAACWdldF9hZG1pbgAAAAAAAAAAAAABAAAD6AAAABM=", "AAAAAAAAARBSZXR1cm4gdGhlIGN1cnJlbnQgcHJpY2UsIG9yIGFuIGVycm9yIHdoZW4gbm8gZnJlc2ggcHJpY2UgaXMgYXZhaWxhYmxlLgoKTmV2ZXIgcmV0dXJucyBhIGhhcmRjb2RlZCBmYWxsYmFjay4gQSBjb250cmFjdCB0aGF0IGludm9rZXMgdGhpcyBhY3Jvc3MKY29udHJhY3RzIHJldmVydHMgd2hlbiBpdCByZXR1cm5zIGBFcnJgLCB3aGljaCBpcyB0aGUgaW50ZW5kZWQgb3V0Y29tZQpmb3IgcGF5b3V0cyBhbmQgZmVlIGNvbnZlcnNpb25zIGR1cmluZyBhbiBvcmFjbGUgb3V0YWdlLgAAAAlnZXRfcHJpY2UAAAAAAAAAAAAAAQAAA+kAAAfQAAAACVByaWNlRGF0YQAAAAAAB9AAAAALT3JhY2xlRXJyb3IA", "AAAAAAAAADpSZXR1cm4gdGhlIHJlZ2lzdGVyZWQgb3JhY2xlIGFkZHJlc3MsIGlmIG9uZSBoYXMgYmVlbiBzZXQuAAAAAAAKZ2V0X29yYWNsZQAAAAAAAAAAAAEAAAPoAAAAEw==", "AAAAAAAAAAAAAAAKZ2V0X3F1b3J1bQAAAAAAAAAAAAEAAAAE", "AAAAAAAAATlTZXQgdGhlIGNvbnRyYWN0IGFkbWluaXN0cmF0b3IuIENhbGxhYmxlIG9uY2UuCgpXaXRob3V0IHRoaXMsIGBzZXRfb3JhY2xlYCdzIGBhZG1pbmAgcGFyYW1ldGVyIHdhcyBzZWxmLWFzc2VydGVkOiB0aGUKY2FsbGVyIHBhc3NlZCB3aGljaGV2ZXIgYWRkcmVzcyB0aGV5IGNvbnRyb2xsZWQsIGByZXF1aXJlX2F1dGgoKWAKY29uZmlybWVkIG9ubHkgdGhhdCB0aGV5IGNvbnRyb2xsZWQgKnRoYXQqIGFkZHJlc3MsIGFuZCBub3RoaW5nIHRpZWQgaXQKdG8gYW55IHByaXZpbGVnZWQgcm9sZS4gQW55b25lIGNvdWxkIHJlLXBvaW50IHRoZSBvcmFjbGUuAAAAAAAACmluaXRpYWxpemUAAAAAAAEAAAAAAAAABWFkbWluAAAAAAAAEwAAAAA=", "AAAAAAAAAEFSZWdpc3RlciB0aGUgYWRkcmVzcyBvZiB0aGUgdXBzdHJlYW0gb3JhY2xlIGNvbnRyYWN0LiBBZG1pbi1vbmx5LgAAAAAAAApzZXRfb3JhY2xlAAAAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAABm9yYWNsZQAAAAAAEwAAAAA=", "AAAAAAAAAJFTZXQgdGhlIG1pbmltdW0gbnVtYmVyIG9mIGZyZXNoIHJlcG9ydHMgcmVxdWlyZWQgZm9yIGEgbWVkaWFuIHByaWNlLgpgMGAgZGlzYWJsZXMgcmVwb3J0ZXIgYWdncmVnYXRpb24uIEFkbWluLW9ubHkuIEVtaXRzIGAob3JhY2xlLCBxdW9ydW1fc2V0KWAuAAAAAAAACnNldF9xdW9ydW0AAAAAAAIAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAGcXVvcnVtAAAAAAAEAAAAAA==", "AAAAAAAAAFxBY2NlcHQgYSBub21pbmF0aW9uIChzdGVwIDIgb2YgMikuIE11c3QgYmUgc2lnbmVkIGJ5IHRoZSBub21pbmVlLgpFbWl0cyBgKGFkbWluLCBhY2NlcHRlZClgLgAAAAxhY2NlcHRfYWRtaW4AAAABAAAAAAAAAAluZXdfYWRtaW4AAAAAAAATAAAAAA==", "AAAAAAAAAERBdXRob3Jpc2UgYSBwcmljZSByZXBvcnRlci4gQWRtaW4tb25seS4gRW1pdHMgYChvcmFjbGUsIHJlcF9hZGRlZClgLgAAAAxhZGRfcmVwb3J0ZXIAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAACHJlcG9ydGVyAAAAEwAAAAA=", "AAAAAAAAAEVQdXNoIGEgbmV3IHByaWNlIG9ic2VydmF0aW9uLiBDYWxsYWJsZSBvbmx5IGJ5IHRoZSByZWdpc3RlcmVkIG9yYWNsZS4AAAAAAAAMdXBkYXRlX3ByaWNlAAAAAgAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAApwcmljZV9kYXRhAAAAAAfQAAAACVByaWNlRGF0YQAAAAAAAAA=", "AAAAAAAAAAAAAAANZ2V0X3JlZmxlY3RvcgAAAAAAAAAAAAABAAAD6AAAB9AAAAAPUmVmbGVjdG9yQ29uZmlnAA==", "AAAAAAAAAAAAAAANZ2V0X3JlcG9ydGVycwAAAAAAAAAAAAABAAAD6gAAABM=", "AAAAAAAAAEpOb21pbmF0ZSBhIG5ldyBhZG1pbiAoc3RlcCAxIG9mIDIpLiBBZG1pbi1vbmx5LiBFbWl0cyBgKGFkbWluLCBwcm9wb3NlZClgLgAAAAAADXByb3Bvc2VfYWRtaW4AAAAAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAACW5ld19hZG1pbgAAAAAAABMAAAAA", "AAAAAAAAAHBDb25maWd1cmUgdGhlIFJlZmxlY3RvciAoU0VQLTQwKSBjb250cmFjdCB1c2VkIGFzIHNlY29uZGFyeSBzb3VyY2UuCkFkbWluLW9ubHkuIEVtaXRzIGAob3JhY2xlLCByZWZsZWN0b3Jfc2V0KWAuAAAADXNldF9yZWZsZWN0b3IAAAAAAAADAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAACGNvbnRyYWN0AAAAEwAAAAAAAAAFYXNzZXQAAAAAAAfQAAAABUFzc2V0AAAAAAAAAA==", "AAAAAAAAAJNTdWJtaXQgYSBwcmljZSByZXBvcnQuIENhbGxhYmxlIG9ubHkgYnkgYW4gYXV0aG9yaXNlZCByZXBvcnRlci4KVGhlIHJlcG9ydCBpcyB0aW1lc3RhbXBlZCB3aXRoIHRoZSBjdXJyZW50IGxlZGdlciB0aW1lLgpFbWl0cyBgKG9yYWNsZSwgcmVwb3J0ZWQpYC4AAAAADXN1Ym1pdF9yZXBvcnQAAAAAAAACAAAAAAAAAAhyZXBvcnRlcgAAABMAAAAAAAAAD3ByaWNlX21pY3JvX3VzZAAAAAALAAAAAA==", "AAAAAAAAAEdXaXRoZHJhdyB0aGUgcGVuZGluZyB1cGdyYWRlLiBBZG1pbi1vbmx5LiBFbWl0cyBgKHVwZ3JhZGUsIGNhbmNlbGxlZClgLgAAAAAOY2FuY2VsX3VwZ3JhZGUAAAAAAAEAAAAAAAAABWFkbWluAAAAAAAAEwAAAAA=", "AAAAAAAAAElSZW1vdmUgdGhlIHNlY29uZGFyeSBzb3VyY2UuIEFkbWluLW9ubHkuIEVtaXRzIGAob3JhY2xlLCByZWZsZWN0b3JfY2xyKWAuAAAAAAAAD2NsZWFyX3JlZmxlY3RvcgAAAAABAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAA", "AAAAAAAAAGJBcHBseSB0aGUgcGVuZGluZyB1cGdyYWRlIG9uY2UgaXRzIHRpbWVsb2NrIGhhcyBlbGFwc2VkLiBBZG1pbi1vbmx5LgpFbWl0cyBgKGNvbnRyYWN0LCB1cGdyYWRlZClgLgAAAAAAD2V4ZWN1dGVfdXBncmFkZQAAAAABAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAA", "AAAAAAAAAJZQcm9wb3NlIGEgV0FTTSB1cGdyYWRlLiBBZG1pbi1vbmx5LiBSZXR1cm5zIHRoZSBsZWRnZXIgdGltZXN0YW1wIGFmdGVyCndoaWNoIGBleGVjdXRlX3VwZ3JhZGVgIG1heSBiZSBjYWxsZWQgKG5vdyArIDQ4aCkuIEVtaXRzCmAodXBncmFkZSwgcHJvcG9zZWQpYC4AAAAAAA9wcm9wb3NlX3VwZ3JhZGUAAAAAAgAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAA1uZXdfd2FzbV9oYXNoAAAAAAAD7gAAACAAAAABAAAABg==", "AAAAAAAAAJ5SZXZva2UgYSBwcmljZSByZXBvcnRlciBhbmQgZHJvcCBpdHMgbGFzdCByZXBvcnQuIEFkbWluLW9ubHkuCkZhaWxzIGlmIHRoZSByZW1vdmFsIHdvdWxkIGxlYXZlIGZld2VyIHJlcG9ydGVycyB0aGFuIHRoZSBxdW9ydW0uCkVtaXRzIGAob3JhY2xlLCByZXBfcmVtb3ZlZClgLgAAAAAAD3JlbW92ZV9yZXBvcnRlcgAAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAACHJlcG9ydGVyAAAAEwAAAAA=", "AAAAAAAAAR1Db252ZXJ0IGEgVVNELWRlbm9taW5hdGVkIGJvdW50eSBhbW91bnQgdG8gdG9rZW5zIGF0IHRoZSBjdXJyZW50IG9yYWNsZQpwcmljZSwgYXRvbWljYWxseSBhdCB0aGUgbW9tZW50IG9mIGV4ZWN1dGlvbi4KCmB1c2RfYW1vdW50X21pY3JvYCDigJMgdGhlIGJvdW50eSB2YWx1ZSBpbiBtaWNyby1VU0QgKGUuZy4gJDEwMCA9IDEwMF8wMDBfMDAwKS4KClJldHVybnMgYEVycihPcmFjbGVFcnJvcjo6U3RhbGUgfCBOb1ByaWNlKWAgcmF0aGVyIHRoYW4gY29udmVydGluZyBhdCBhCm1hZGUtdXAgcmF0ZS4AAAAAAAAPdmFsdWVfaW5fdG9rZW5zAAAAAAEAAAAAAAAAEHVzZF9hbW91bnRfbWljcm8AAAALAAAAAQAAA+kAAAfQAAAAD1ZhbHVhdGlvblJlc3VsdAAAAAfQAAAAC09yYWNsZUVycm9yAA==", "AAAAAAAAADFUaGUgbm9taW5hdGVkLWJ1dC1ub3QteWV0LWFjY2VwdGVkIGFkbWluLCBpZiBhbnkuAAAAAAAAEWdldF9wZW5kaW5nX2FkbWluAAAAAAAAAAAAAAEAAAPoAAAAEw==", "AAAAAAAAADdUaGUgdXBncmFkZSBjdXJyZW50bHkgd2FpdGluZyBvdXQgaXRzIHRpbWVsb2NrLCBpZiBhbnkuAAAAABNnZXRfcGVuZGluZ191cGdyYWRlAAAAAAAAAAABAAAD6AAAB9AAAAAOUGVuZGluZ1VwZ3JhZGUAAA==", "AAAAAAAAAIpSZXR1cm4gdGhlIGJlc3Qga25vd24gcHJpY2UgZm9yIFVJIGRpc3BsYXksIGZsYWdnZWQgd2hlbiBzdGFsZS4KCk11c3Qgbm90IGJlIHVzZWQgZm9yIHZhbHVlIHRyYW5zZmVyOiB1c2UgYGdldF9wcmljZWAgLyBgdmFsdWVfaW5fdG9rZW5zYC4AAAAAABNnZXRfcHJpY2VfdW5jaGVja2VkAAAAAAAAAAABAAAD6AAAB9AAAAAJUHJpY2VWaWV3AAAA", "AAAAAAAAAExXaXRoZHJhdyBhIHBlbmRpbmcgYWRtaW4gbm9taW5hdGlvbi4gQWRtaW4tb25seS4gRW1pdHMgYChhZG1pbiwgY2FuY2VsbGVkKWAuAAAAFWNhbmNlbF9hZG1pbl90cmFuc2ZlcgAAAAAAAAEAAAAAAAAABWFkbWluAAAAAAAAEwAAAAA=", "AAAABAAAAK1FcnJvcnMgcmFpc2VkIGJ5IHRoZSBzaGFyZWQgdXBncmFkZS9hZG1pbiBoZWxwZXJzLgoKQ29kZXMgc3RhcnQgYXQgOTAwIHNvIHRoZXkgZG9uJ3Qgb3ZlcmxhcCBhbnkgY29udHJhY3QncyBvd24gZXJyb3IgZW51bTsKdGhleSBzdXJmYWNlIG9uLWNoYWluIGFzIGBFcnJvcihDb250cmFjdCwgIzl4eClgLgAAAAAAAAAAAAAMVXBncmFkZUVycm9yAAAABgAAAB9DYWxsZXIgaXMgbm90IHRoZSBzdG9yZWQgYWRtaW4uAAAAAAxVbmF1dGhvcml6ZWQAAAOEAAAAQWBleGVjdXRlX3VwZ3JhZGVgIC8gYGNhbmNlbF91cGdyYWRlYCBjYWxsZWQgd2l0aCBub3RoaW5nIHBlbmRpbmcuAAAAAAAAEE5vUGVuZGluZ1VwZ3JhZGUAAAOFAAAAMGBleGVjdXRlX3VwZ3JhZGVgIGNhbGxlZCBiZWZvcmUgYGV4ZWN1dGFibGVfYXRgLgAAABJUaW1lbG9ja05vdEVsYXBzZWQAAAAAA4YAAABFYGFjY2VwdF9hZG1pbmAgLyBgY2FuY2VsX2FkbWluX3RyYW5zZmVyYCBjYWxsZWQgd2l0aCBub3RoaW5nIHBlbmRpbmcuAAAAAAAADk5vUGVuZGluZ0FkbWluAAAAAAOHAAAAO2BhY2NlcHRfYWRtaW5gIHNpZ25lZCBieSBhbiBhZGRyZXNzIG90aGVyIHRoYW4gdGhlIG5vbWluZWUuAAAAAA9Ob3RQZW5kaW5nQWRtaW4AAAADiAAAACxgcHJvcG9zZV9hZG1pbmAgbm9taW5hdGVkIHRoZSBjdXJyZW50IGFkbWluLgAAAAlTYW1lQWRtaW4AAAAAAAOJ", "AAAAAQAAADFBIHByb3Bvc2VkIGNvZGUgdXBncmFkZSB3YWl0aW5nIG91dCBpdHMgdGltZWxvY2suAAAAAAAAAAAAAA5QZW5kaW5nVXBncmFkZQAAAAAAAwAAAAAAAAANZXhlY3V0YWJsZV9hdAAAAAAAAAYAAAAAAAAAC3Byb3Bvc2VkX2F0AAAAAAYAAAAAAAAACXdhc21faGFzaAAAAAAAA+4AAAAg"]),
      options
    );
  }

   static deploy<T = Client>(options: MethodOptions & Omit<ContractClientOptions, 'contractId'> & { wasmHash: Buffer | string; salt?: Buffer | Uint8Array; format?: "hex" | "base64"; address?: string; }): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options);
  }
  public readonly fromJSON = {
    get_admin : this.txFromJSON<string | null>,  get_price : this.txFromJSON<Result<PriceData, OracleError>>,  get_oracle : this.txFromJSON<string | null>,  get_quorum : this.txFromJSON<number>,  initialize : this.txFromJSON<void>,  set_oracle : this.txFromJSON<void>,  set_quorum : this.txFromJSON<void>,  accept_admin : this.txFromJSON<void>,  add_reporter : this.txFromJSON<void>,  update_price : this.txFromJSON<void>,  get_reflector : this.txFromJSON<ReflectorConfig | null>,  get_reporters : this.txFromJSON<Array<string>>,  propose_admin : this.txFromJSON<void>,  set_reflector : this.txFromJSON<void>,  submit_report : this.txFromJSON<void>,  cancel_upgrade : this.txFromJSON<void>,  clear_reflector : this.txFromJSON<void>,  execute_upgrade : this.txFromJSON<void>,  propose_upgrade : this.txFromJSON<bigint>,  remove_reporter : this.txFromJSON<void>,  value_in_tokens : this.txFromJSON<Result<ValuationResult, OracleError>>,  get_pending_admin : this.txFromJSON<string | null>,  get_pending_upgrade : this.txFromJSON<PendingUpgrade | null>,  get_price_unchecked : this.txFromJSON<PriceView | null>,  cancel_admin_transfer : this.txFromJSON<void>
  };

}