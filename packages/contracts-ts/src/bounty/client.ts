import {Bounty, BountyApplication, BountyStatus} from './types';
import {Spec, AssembledTransaction, Client as ContractClient, ClientOptions as ContractClientOptions, MethodOptions} from '@stellar/stellar-sdk/contract';
import {Address} from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';

export interface Client {
  /**
   * Upgrade the contract WASM. Only the governance multisig (contract admin)
   * may call this. Emits an `upgraded` event with the new wasm hash.
   */
  upgrade({ admin, new_wasm_hash }: { admin: string | Address; new_wasm_hash: Buffer }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Set the bounty contract admin (governance multisig). Can only be called once.
   */
  set_admin({ admin }: { admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  get_bounty({ bounty_id }: { bounty_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Bounty>>;
  /**
   * Set the contract admin. Must be called once before any admin-gated
   * method (`set_escrow_contract`, `set_multisig_signers`, ...).
   */
  initialize({ admin }: { admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  link_escrow({ bounty_id, escrow_id }: { bounty_id: bigint; escrow_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  cancel_bounty({ bounty_id }: { bounty_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  create_bounty({ creator, title, description, budget, deadline }: { creator: string | Address; title: string; description: string; budget: bigint; deadline: bigint }, options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  /**
   * Approve completion and release payment.
   *
   * `approvers` names the multi-sig signers authorising this call. It is
   * ignored for bounties below the multi-sig threshold — pass an empty
   * `Vec` for those. Above the threshold it must contain at least
   * `required` distinct addresses, all drawn from the configured signer
   * set, and each must have authorised the invocation.
   *
   * Any `required`-sized subset satisfies the policy; the signers no longer
   * have to be the first `required` entries in the stored order (#1113).
   */
  complete_bounty({ bounty_id, approvers }: { bounty_id: bigint; approvers: Array<string | Address> }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  get_application({ application_id }: { application_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<BountyApplication>>;
  apply_for_bounty({ bounty_id, freelancer, proposal, proposed_budget, timeline }: { bounty_id: bigint; freelancer: string | Address; proposal: string; proposed_budget: bigint; timeline: bigint }, options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  get_applications({ bounty_id }: { bounty_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Array<BountyApplication>>>;
  select_freelancer({ bounty_id, application_id }: { bounty_id: bigint; application_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  /**
   * Called by the selected freelancer to signal work is done.
   * Transitions the bounty from InProgress → PendingCompletion. (#160)
   * The creator must then call complete_bounty to approve.
   */
  submit_completion({ bounty_id, freelancer }: { bounty_id: bigint; freelancer: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  get_bounties_count(options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  set_escrow_contract({ admin, escrow }: { admin: string | Address; escrow: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  /**
   * Configure the M-of-N signer set for high-value bounty payments.
   *
   * Only the stored contract admin (governance multisig) may call this.
   * `signers` is the full ordered list of authorised addresses; `required`
   * is the minimum number of them that must call `require_auth()` before
   * `complete_bounty` proceeds for budgets above the threshold.
   */
  set_multisig_signers({ admin, signers, required }: { admin: string | Address; signers: Array<string | Address>; required: number }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  create_and_fund_bounty({ creator, title, description, budget, token, deadline }: { creator: string | Address; title: string; description: string; budget: bigint; token: string | Address; deadline: bigint }, options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  /**
   * Optimized view: return all bounties matching a given status.
   * Avoids loading all bounties when only a subset is needed.
   */
  get_bounties_by_status({ status }: { status: BountyStatus }, options?: MethodOptions): Promise<AssembledTransaction<Array<Bounty>>>;
  /**
   * Optimized view: return a paginated slice of all bounties.
   * `offset` is zero-based; returns at most `limit` items.
   */
  get_bounties_paginated({ offset, limit }: { offset: bigint; limit: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Array<Bounty>>>;
  /**
   * Return the configured multi-sig threshold (or the compile-time default).
   */
  get_multisig_threshold(options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  /**
   * Update the budget threshold above which multi-sig is enforced.
   * Only the contract admin may call this.
   */
  set_multisig_threshold({ admin, threshold }: { admin: string | Address; threshold: bigint }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  check_and_expire_bounty({ bounty_id, escrow_contract }: { bounty_id: bigint; escrow_contract: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  /**
   * Estimate the total fee for creating a bounty with the given budget.
   * Returns: platform_fee + base_resource_fee
   *
   * Note: actual fee may vary by up to 10% from this estimate due to network conditions.
   * The estimate is guaranteed not to exceed actual fee by more than 10%.
   */
  estimate_create_bounty_fee({ budget }: { budget: bigint }, options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
}

export class Client extends ContractClient {
  constructor(public readonly options: ContractClientOptions) {
    super(
      new Spec(["AAAAAQAAAA1Cb3VudHkgU3RydWN0AAAAAAAAAAAAAAZCb3VudHkAAAAAAAsAAAAAAAAABmJ1ZGdldAAAAAAACwAAAAAAAAAMY29tcGxldGVkX2F0AAAD6AAAAAYAAAAAAAAACmNyZWF0ZWRfYXQAAAAAAAYAAAAAAAAAB2NyZWF0b3IAAAAAEwAAAAAAAAAIZGVhZGxpbmUAAAAGAAAAAAAAAAtkZXNjcmlwdGlvbgAAAAAQAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAGAAAAAAAAAAJpZAAAAAAABgAAAAAAAAATc2VsZWN0ZWRfZnJlZWxhbmNlcgAAAAPoAAAAEwAAAAAAAAAGc3RhdHVzAAAAAAfQAAAADEJvdW50eVN0YXR1cwAAAAAAAAAFdGl0bGUAAAAAAAAQ", "AAAAAgAAACFEYXRhS2V5IGZvciB0eXBlZCBzdG9yYWdlIGxvb2t1cHMAAAAAAAAAAAAAB0RhdGFLZXkAAAAABAAAAAAAAAAAAAAADkVzY3Jvd0NvbnRyYWN0AAAAAAAAAAAAN09yZGVyZWQgbGlzdCBvZiBhdXRob3Jpc2VkIG11bHRpLXNpZyBzaWduZXJzIChBZGRyZXNzKS4AAAAAD011bHRpc2lnU2lnbmVycwAAAAAAAAAAQE1pbmltdW0gbnVtYmVyIG9mIHNpZ25lcnMgcmVxdWlyZWQgKE0gaW4gTS1vZi1OKS4gRGVmYXVsdHMgdG8gMi4AAAAQTXVsdGlzaWdSZXF1aXJlZAAAAAAAAABER292ZXJuYW5jZS1jb25maWd1cmFibGUgdGhyZXNob2xkIGFib3ZlIHdoaWNoIG11bHRpLXNpZyBpcyBlbmZvcmNlZC4AAAARTXVsdGlzaWdUaHJlc2hvbGQAAAA=", "AAAABAAAABJCb3VudHkgRXJyb3IgQ29kZXMAAAAAAAAAAAALQm91bnR5RXJyb3IAAAAABQAAAAAAAAARRGVhZGxpbmVOb3RQYXNzZWQAAAAAAAABAAAAAAAAABBBbHJlYWR5UHJvY2Vzc2VkAAAAAgAAAAAAAAATSW5zdWZmaWNpZW50QmFsYW5jZQAAAAADAAAATkJvdW50eSBidWRnZXQgZXhjZWVkcyB0aGUgbXVsdGktc2lnIHRocmVzaG9sZCBhbmQgbm8gc2lnbmVyIHNldCBpcyBjb25maWd1cmVkLgAAAAAAFU11bHRpc2lnTm90Q29uZmlndXJlZAAAAAAAAAQAAABKRmV3ZXIgc2lnbmVycyBhdXRob3Jpc2VkIHRoYW4gdGhlIHJlcXVpcmVkIG1pbmltdW0gKE0tb2YtTiBub3Qgc2F0aXNmaWVkKS4AAAAAABNJbnN1ZmZpY2llbnRTaWduZXJzAAAAAAU=", "AAAAAwAAABJCb3VudHkgU3RhdHVzIEVudW0AAAAAAAAAAAAMQm91bnR5U3RhdHVzAAAABgAAAAAAAAAET3BlbgAAAAAAAAAAAAAACkluUHJvZ3Jlc3MAAAAAAAEAAAAAAAAACUNvbXBsZXRlZAAAAAAAAAIAAAAAAAAACERpc3B1dGVkAAAAAwAAAAAAAAAJQ2FuY2VsbGVkAAAAAAAABAAAAAAAAAARUGVuZGluZ0NvbXBsZXRpb24AAAAAAAAF", "AAAAAgAAAAAAAAAAAAAAEFJlbGVhc2VDb25kaXRpb24AAAACAAAAAAAAAAAAAAAMT25Db21wbGV0aW9uAAAAAQAAAAAAAAAIVGltZWxvY2sAAAABAAAABg==", "AAAAAQAAABlCb3VudHkgQXBwbGljYXRpb24gU3RydWN0AAAAAAAAAAAAABFCb3VudHlBcHBsaWNhdGlvbgAAAAAAAAgAAAAAAAAACWJvdW50eV9pZAAAAAAAAAYAAAAAAAAACmNyZWF0ZWRfYXQAAAAAAAYAAAAAAAAACmZyZWVsYW5jZXIAAAAAABMAAAAAAAAAAmlkAAAAAAAGAAAAAAAAAAhwcm9wb3NhbAAAABAAAAAAAAAAD3Byb3Bvc2VkX2J1ZGdldAAAAAALAAAAAAAAAAZzdGF0dXMAAAAAABAAAAAAAAAACHRpbWVsaW5lAAAABg==", "AAAAAAAAAIlVcGdyYWRlIHRoZSBjb250cmFjdCBXQVNNLiBPbmx5IHRoZSBnb3Zlcm5hbmNlIG11bHRpc2lnIChjb250cmFjdCBhZG1pbikKbWF5IGNhbGwgdGhpcy4gRW1pdHMgYW4gYHVwZ3JhZGVkYCBldmVudCB3aXRoIHRoZSBuZXcgd2FzbSBoYXNoLgAAAAAAAAd1cGdyYWRlAAAAAAIAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAANbmV3X3dhc21faGFzaAAAAAAAA+4AAAAgAAAAAA==", "AAAAAAAAAE1TZXQgdGhlIGJvdW50eSBjb250cmFjdCBhZG1pbiAoZ292ZXJuYW5jZSBtdWx0aXNpZykuIENhbiBvbmx5IGJlIGNhbGxlZCBvbmNlLgAAAAAAAAlzZXRfYWRtaW4AAAAAAAABAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAA", "AAAAAAAAAAAAAAAKZ2V0X2JvdW50eQAAAAAAAQAAAAAAAAAJYm91bnR5X2lkAAAAAAAABgAAAAEAAAfQAAAABkJvdW50eQAA", "AAAAAAAAAH9TZXQgdGhlIGNvbnRyYWN0IGFkbWluLiBNdXN0IGJlIGNhbGxlZCBvbmNlIGJlZm9yZSBhbnkgYWRtaW4tZ2F0ZWQKbWV0aG9kIChgc2V0X2VzY3Jvd19jb250cmFjdGAsIGBzZXRfbXVsdGlzaWdfc2lnbmVyc2AsIC4uLikuAAAAAAppbml0aWFsaXplAAAAAAABAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAA", "AAAAAAAAAAAAAAALbGlua19lc2Nyb3cAAAAAAgAAAAAAAAAJYm91bnR5X2lkAAAAAAAABgAAAAAAAAAJZXNjcm93X2lkAAAAAAAABgAAAAEAAAAB", "AAAAAAAAAAAAAAANY2FuY2VsX2JvdW50eQAAAAAAAAEAAAAAAAAACWJvdW50eV9pZAAAAAAAAAYAAAABAAAAAQ==", "AAAAAAAAAAAAAAANY3JlYXRlX2JvdW50eQAAAAAAAAUAAAAAAAAAB2NyZWF0b3IAAAAAEwAAAAAAAAAFdGl0bGUAAAAAAAAQAAAAAAAAAAtkZXNjcmlwdGlvbgAAAAAQAAAAAAAAAAZidWRnZXQAAAAAAAsAAAAAAAAACGRlYWRsaW5lAAAABgAAAAEAAAAG", "AAAAAAAAAfVBcHByb3ZlIGNvbXBsZXRpb24gYW5kIHJlbGVhc2UgcGF5bWVudC4KCmBhcHByb3ZlcnNgIG5hbWVzIHRoZSBtdWx0aS1zaWcgc2lnbmVycyBhdXRob3Jpc2luZyB0aGlzIGNhbGwuIEl0IGlzCmlnbm9yZWQgZm9yIGJvdW50aWVzIGJlbG93IHRoZSBtdWx0aS1zaWcgdGhyZXNob2xkIOKAlCBwYXNzIGFuIGVtcHR5CmBWZWNgIGZvciB0aG9zZS4gQWJvdmUgdGhlIHRocmVzaG9sZCBpdCBtdXN0IGNvbnRhaW4gYXQgbGVhc3QKYHJlcXVpcmVkYCBkaXN0aW5jdCBhZGRyZXNzZXMsIGFsbCBkcmF3biBmcm9tIHRoZSBjb25maWd1cmVkIHNpZ25lcgpzZXQsIGFuZCBlYWNoIG11c3QgaGF2ZSBhdXRob3Jpc2VkIHRoZSBpbnZvY2F0aW9uLgoKQW55IGByZXF1aXJlZGAtc2l6ZWQgc3Vic2V0IHNhdGlzZmllcyB0aGUgcG9saWN5OyB0aGUgc2lnbmVycyBubyBsb25nZXIKaGF2ZSB0byBiZSB0aGUgZmlyc3QgYHJlcXVpcmVkYCBlbnRyaWVzIGluIHRoZSBzdG9yZWQgb3JkZXIgKCMxMTEzKS4AAAAAAAAPY29tcGxldGVfYm91bnR5AAAAAAIAAAAAAAAACWJvdW50eV9pZAAAAAAAAAYAAAAAAAAACWFwcHJvdmVycwAAAAAAA+oAAAATAAAAAQAAAAE=", "AAAAAAAAAAAAAAAPZ2V0X2FwcGxpY2F0aW9uAAAAAAEAAAAAAAAADmFwcGxpY2F0aW9uX2lkAAAAAAAGAAAAAQAAB9AAAAARQm91bnR5QXBwbGljYXRpb24AAAA=", "AAAAAAAAAAAAAAAQYXBwbHlfZm9yX2JvdW50eQAAAAUAAAAAAAAACWJvdW50eV9pZAAAAAAAAAYAAAAAAAAACmZyZWVsYW5jZXIAAAAAABMAAAAAAAAACHByb3Bvc2FsAAAAEAAAAAAAAAAPcHJvcG9zZWRfYnVkZ2V0AAAAAAsAAAAAAAAACHRpbWVsaW5lAAAABgAAAAEAAAAG", "AAAAAAAAAAAAAAAQZ2V0X2FwcGxpY2F0aW9ucwAAAAEAAAAAAAAACWJvdW50eV9pZAAAAAAAAAYAAAABAAAD6gAAB9AAAAARQm91bnR5QXBwbGljYXRpb24AAAA=", "AAAAAAAAAAAAAAARc2VsZWN0X2ZyZWVsYW5jZXIAAAAAAAACAAAAAAAAAAlib3VudHlfaWQAAAAAAAAGAAAAAAAAAA5hcHBsaWNhdGlvbl9pZAAAAAAABgAAAAEAAAAB", "AAAAAAAAALVDYWxsZWQgYnkgdGhlIHNlbGVjdGVkIGZyZWVsYW5jZXIgdG8gc2lnbmFsIHdvcmsgaXMgZG9uZS4KVHJhbnNpdGlvbnMgdGhlIGJvdW50eSBmcm9tIEluUHJvZ3Jlc3Mg4oaSIFBlbmRpbmdDb21wbGV0aW9uLiAoIzE2MCkKVGhlIGNyZWF0b3IgbXVzdCB0aGVuIGNhbGwgY29tcGxldGVfYm91bnR5IHRvIGFwcHJvdmUuAAAAAAAAEXN1Ym1pdF9jb21wbGV0aW9uAAAAAAAAAgAAAAAAAAAJYm91bnR5X2lkAAAAAAAABgAAAAAAAAAKZnJlZWxhbmNlcgAAAAAAEwAAAAEAAAAB", "AAAAAAAAAAAAAAASZ2V0X2JvdW50aWVzX2NvdW50AAAAAAAAAAAAAQAAAAY=", "AAAAAAAAAAAAAAATc2V0X2VzY3Jvd19jb250cmFjdAAAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAABmVzY3JvdwAAAAAAEwAAAAEAAAAB", "AAAAAAAAAUxDb25maWd1cmUgdGhlIE0tb2YtTiBzaWduZXIgc2V0IGZvciBoaWdoLXZhbHVlIGJvdW50eSBwYXltZW50cy4KCk9ubHkgdGhlIHN0b3JlZCBjb250cmFjdCBhZG1pbiAoZ292ZXJuYW5jZSBtdWx0aXNpZykgbWF5IGNhbGwgdGhpcy4KYHNpZ25lcnNgIGlzIHRoZSBmdWxsIG9yZGVyZWQgbGlzdCBvZiBhdXRob3Jpc2VkIGFkZHJlc3NlczsgYHJlcXVpcmVkYAppcyB0aGUgbWluaW11bSBudW1iZXIgb2YgdGhlbSB0aGF0IG11c3QgY2FsbCBgcmVxdWlyZV9hdXRoKClgIGJlZm9yZQpgY29tcGxldGVfYm91bnR5YCBwcm9jZWVkcyBmb3IgYnVkZ2V0cyBhYm92ZSB0aGUgdGhyZXNob2xkLgAAABRzZXRfbXVsdGlzaWdfc2lnbmVycwAAAAMAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAHc2lnbmVycwAAAAPqAAAAEwAAAAAAAAAIcmVxdWlyZWQAAAAEAAAAAQAAAAE=", "AAAAAAAAAAAAAAAWY3JlYXRlX2FuZF9mdW5kX2JvdW50eQAAAAAABgAAAAAAAAAHY3JlYXRvcgAAAAATAAAAAAAAAAV0aXRsZQAAAAAAABAAAAAAAAAAC2Rlc2NyaXB0aW9uAAAAABAAAAAAAAAABmJ1ZGdldAAAAAAACwAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAAAAAAhkZWFkbGluZQAAAAYAAAABAAAABg==", "AAAAAAAAAHZPcHRpbWl6ZWQgdmlldzogcmV0dXJuIGFsbCBib3VudGllcyBtYXRjaGluZyBhIGdpdmVuIHN0YXR1cy4KQXZvaWRzIGxvYWRpbmcgYWxsIGJvdW50aWVzIHdoZW4gb25seSBhIHN1YnNldCBpcyBuZWVkZWQuAAAAAAAWZ2V0X2JvdW50aWVzX2J5X3N0YXR1cwAAAAAAAQAAAAAAAAAGc3RhdHVzAAAAAAfQAAAADEJvdW50eVN0YXR1cwAAAAEAAAPqAAAH0AAAAAZCb3VudHkAAA==", "AAAAAAAAAHBPcHRpbWl6ZWQgdmlldzogcmV0dXJuIGEgcGFnaW5hdGVkIHNsaWNlIG9mIGFsbCBib3VudGllcy4KYG9mZnNldGAgaXMgemVyby1iYXNlZDsgcmV0dXJucyBhdCBtb3N0IGBsaW1pdGAgaXRlbXMuAAAAFmdldF9ib3VudGllc19wYWdpbmF0ZWQAAAAAAAIAAAAAAAAABm9mZnNldAAAAAAABgAAAAAAAAAFbGltaXQAAAAAAAAGAAAAAQAAA+oAAAfQAAAABkJvdW50eQAA", "AAAAAAAAAEhSZXR1cm4gdGhlIGNvbmZpZ3VyZWQgbXVsdGktc2lnIHRocmVzaG9sZCAob3IgdGhlIGNvbXBpbGUtdGltZSBkZWZhdWx0KS4AAAAWZ2V0X211bHRpc2lnX3RocmVzaG9sZAAAAAAAAAAAAAEAAAAL", "AAAAAAAAAGVVcGRhdGUgdGhlIGJ1ZGdldCB0aHJlc2hvbGQgYWJvdmUgd2hpY2ggbXVsdGktc2lnIGlzIGVuZm9yY2VkLgpPbmx5IHRoZSBjb250cmFjdCBhZG1pbiBtYXkgY2FsbCB0aGlzLgAAAAAAABZzZXRfbXVsdGlzaWdfdGhyZXNob2xkAAAAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAACXRocmVzaG9sZAAAAAAAAAsAAAABAAAAAQ==", "AAAAAAAAAAAAAAAXY2hlY2tfYW5kX2V4cGlyZV9ib3VudHkAAAAAAgAAAAAAAAAJYm91bnR5X2lkAAAAAAAABgAAAAAAAAAPZXNjcm93X2NvbnRyYWN0AAAAABMAAAABAAAAAQ==", "AAAAAAAAAQlFc3RpbWF0ZSB0aGUgdG90YWwgZmVlIGZvciBjcmVhdGluZyBhIGJvdW50eSB3aXRoIHRoZSBnaXZlbiBidWRnZXQuClJldHVybnM6IHBsYXRmb3JtX2ZlZSArIGJhc2VfcmVzb3VyY2VfZmVlCgpOb3RlOiBhY3R1YWwgZmVlIG1heSB2YXJ5IGJ5IHVwIHRvIDEwJSBmcm9tIHRoaXMgZXN0aW1hdGUgZHVlIHRvIG5ldHdvcmsgY29uZGl0aW9ucy4KVGhlIGVzdGltYXRlIGlzIGd1YXJhbnRlZWQgbm90IHRvIGV4Y2VlZCBhY3R1YWwgZmVlIGJ5IG1vcmUgdGhhbiAxMCUuAAAAAAAAGmVzdGltYXRlX2NyZWF0ZV9ib3VudHlfZmVlAAAAAAABAAAAAAAAAAZidWRnZXQAAAAAAAsAAAABAAAACw=="]),
      options
    );
  }

   static deploy<T = Client>(options: MethodOptions & Omit<ContractClientOptions, 'contractId'> & { wasmHash: Buffer | string; salt?: Buffer | Uint8Array; format?: "hex" | "base64"; address?: string; }): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options);
  }
  public readonly fromJSON = {
    upgrade : this.txFromJSON<void>,  set_admin : this.txFromJSON<void>,  get_bounty : this.txFromJSON<Bounty>,  initialize : this.txFromJSON<void>,  link_escrow : this.txFromJSON<boolean>,  cancel_bounty : this.txFromJSON<boolean>,  create_bounty : this.txFromJSON<bigint>,  complete_bounty : this.txFromJSON<boolean>,  get_application : this.txFromJSON<BountyApplication>,  apply_for_bounty : this.txFromJSON<bigint>,  get_applications : this.txFromJSON<Array<BountyApplication>>,  select_freelancer : this.txFromJSON<boolean>,  submit_completion : this.txFromJSON<boolean>,  get_bounties_count : this.txFromJSON<bigint>,  set_escrow_contract : this.txFromJSON<boolean>,  set_multisig_signers : this.txFromJSON<boolean>,  create_and_fund_bounty : this.txFromJSON<bigint>,  get_bounties_by_status : this.txFromJSON<Array<Bounty>>,  get_bounties_paginated : this.txFromJSON<Array<Bounty>>,  get_multisig_threshold : this.txFromJSON<bigint>,  set_multisig_threshold : this.txFromJSON<boolean>,  check_and_expire_bounty : this.txFromJSON<boolean>,  estimate_create_bounty_fee : this.txFromJSON<bigint>
  };

}