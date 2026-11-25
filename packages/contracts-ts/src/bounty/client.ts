import {BountyError, Bounty, BountyApplication, PendingUpgrade, BountyStatus} from './types';
import {Result, Spec, AssembledTransaction, Client as ContractClient, ClientOptions as ContractClientOptions, MethodOptions} from '@stellar/stellar-sdk/contract';
import {Address} from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';

export interface Client {
  /**
   * The current contract admin.
   */
  get_admin(options?: MethodOptions): Promise<AssembledTransaction<Result<string, BountyError>>>;
  get_bounty({ bounty_id }: { bounty_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<Bounty, BountyError>>>;
  /**
   * Link an escrow the creator deposited directly (with `bounty_id`) to the
   * bounty. #1714: only while the bounty is Open and unlinked; the escrow
   * contract verifies the escrow is Active, belongs to this bounty and was
   * paid by the creator, and binds it so it can only be released/refunded
   * through this contract.
   */
  link_escrow({ bounty_id, escrow_id }: { bounty_id: bigint; escrow_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<boolean, BountyError>>>;
  /**
   * Accept a nomination (step 2 of 2). Must be signed by the nominee.
   * Emits `(admin, accepted)`.
   */
  accept_admin({ new_admin }: { new_admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  cancel_bounty({ bounty_id }: { bounty_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<boolean, BountyError>>>;
  create_bounty({ creator, title, description, budget, deadline }: { creator: string | Address; title: string; description: string; budget: bigint; deadline: bigint }, options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  /**
   * Nominate a new admin (step 1 of 2). Admin-only. Emits `(admin, proposed)`.
   */
  propose_admin({ admin, new_admin }: { admin: string | Address; new_admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Withdraw the pending upgrade. Admin-only. Emits `(upgrade, cancelled)`.
   */
  cancel_upgrade({ admin }: { admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Approve completion and release payment. Emits `("bounty", "completed")` —
   * this is the "approved" transition in docs/contracts.md.
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
  complete_bounty({ bounty_id, approvers }: { bounty_id: bigint; approvers: Array<string | Address> }, options?: MethodOptions): Promise<AssembledTransaction<Result<boolean, BountyError>>>;
  /**
   * Apply the pending upgrade once its timelock has elapsed. Admin-only.
   * Emits `(contract, upgraded)`.
   */
  execute_upgrade({ admin }: { admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  get_application({ application_id }: { application_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<BountyApplication, BountyError>>>;
  /**
   * Propose a WASM upgrade. Admin-only. Returns the ledger timestamp after
   * which `execute_upgrade` may be called (now + 48h). Emits
   * `(upgrade, proposed)`.
   */
  propose_upgrade({ admin, new_wasm_hash }: { admin: string | Address; new_wasm_hash: Buffer }, options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  apply_for_bounty({ bounty_id, freelancer, proposal, proposed_budget, timeline }: { bounty_id: bigint; freelancer: string | Address; proposal: string; proposed_budget: bigint; timeline: bigint }, options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  get_applications({ bounty_id }: { bounty_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Array<BountyApplication>>>;
  /**
   * #1714: invariant check — true when the bounty and its linked escrow
   * are in a valid joint state (see `joint_state_valid`).
   */
  check_joint_state({ bounty_id }: { bounty_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<boolean, BountyError>>>;
  /**
   * The nominated-but-not-yet-accepted admin, if any.
   */
  get_pending_admin(options?: MethodOptions): Promise<AssembledTransaction<string | null>>;
  /**
   * One-off migration for contracts deployed before #1708 that still hold
   * their admin under the legacy `admin` key. Moves it into the canonical
   * `bounty_admin` key and deletes the legacy entry so there is exactly one
   * source of truth. Must be signed by the legacy admin. No-op (returns
   * `false`) when there is nothing to migrate. Emits `(bounty, admin_mig)`.
   */
  migrate_admin_key(options?: MethodOptions): Promise<AssembledTransaction<Result<boolean, BountyError>>>;
  /**
   * Assign the bounty to an applicant. Emits `("bounty", "selected")` —
   * this is the "assigned" transition in docs/contracts.md.
   */
  select_freelancer({ bounty_id, application_id }: { bounty_id: bigint; application_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<boolean, BountyError>>>;
  /**
   * Called by the selected freelancer to signal work is done.
   * Transitions the bounty from InProgress → PendingCompletion. (#160)
   * The creator must then call complete_bounty to approve.
   */
  submit_completion({ bounty_id, freelancer }: { bounty_id: bigint; freelancer: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<boolean, BountyError>>>;
  get_bounties_count(options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  /**
   * The upgrade currently waiting out its timelock, if any.
   */
  get_pending_upgrade(options?: MethodOptions): Promise<AssembledTransaction<PendingUpgrade | null>>;
  set_escrow_contract({ admin, escrow }: { admin: string | Address; escrow: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<boolean, BountyError>>>;
  /**
   * True when `account` completed a funded bounty: the bounty is
   * `Completed`, was funded through escrow (`escrow_id != 0`, budget > 0)
   * and `account` is its creator or selected freelancer. Read by the
   * referral contract before paying a reward (issue #1716).
   */
  is_qualifying_bounty({ bounty_id, account }: { bounty_id: bigint; account: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  /**
   * Configure the M-of-N signer set for high-value bounty payments.
   *
   * Only the stored contract admin (governance multisig) may call this.
   * `signers` is the full ordered list of authorised addresses; `required`
   * is the minimum number of them that must call `require_auth()` before
   * `complete_bounty` proceeds for budgets above the threshold.
   */
  set_multisig_signers({ admin, signers, required }: { admin: string | Address; signers: Array<string | Address>; required: number }, options?: MethodOptions): Promise<AssembledTransaction<Result<boolean, BountyError>>>;
  /**
   * Withdraw a pending admin nomination. Admin-only. Emits `(admin, cancelled)`.
   */
  cancel_admin_transfer({ admin }: { admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  create_and_fund_bounty({ creator, title, description, budget, token, deadline }: { creator: string | Address; title: string; description: string; budget: bigint; token: string | Address; deadline: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<bigint, BountyError>>>;
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
  set_multisig_threshold({ admin, threshold }: { admin: string | Address; threshold: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<boolean, BountyError>>>;
  check_and_expire_bounty({ bounty_id, escrow_contract }: { bounty_id: bigint; escrow_contract: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<boolean, BountyError>>>;
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
      new Spec(["AAAAAQAAAA1Cb3VudHkgU3RydWN0AAAAAAAAAAAAAAZCb3VudHkAAAAAAAsAAAAAAAAABmJ1ZGdldAAAAAAACwAAAAAAAAAMY29tcGxldGVkX2F0AAAD6AAAAAYAAAAAAAAACmNyZWF0ZWRfYXQAAAAAAAYAAAAAAAAAB2NyZWF0b3IAAAAAEwAAAAAAAAAIZGVhZGxpbmUAAAAGAAAAAAAAAAtkZXNjcmlwdGlvbgAAAAAQAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAGAAAAAAAAAAJpZAAAAAAABgAAAAAAAAATc2VsZWN0ZWRfZnJlZWxhbmNlcgAAAAPoAAAAEwAAAAAAAAAGc3RhdHVzAAAAAAfQAAAADEJvdW50eVN0YXR1cwAAAAAAAAAFdGl0bGUAAAAAAAAQ", "AAAABAAAAN5Cb3VudHkgRXJyb3IgQ29kZXMKCkNvZGVzIGFyZSBwYXJ0IG9mIHRoZSBjb250cmFjdCdzIHB1YmxpYyBpbnRlcmZhY2U6IGNsaWVudHMgYW5kIHRoZQppbmRleGVyIG1hcCB0aGVtIHRvIG1lc3NhZ2VzLCBzbyBuZXZlciByZW51bWJlciBhbiBleGlzdGluZyB2YXJpYW50IOKAlApvbmx5IGFwcGVuZCBuZXcgb25lcy4gU2VlIGRvY3MvY29udHJhY3RzLm1kIGZvciB0aGUgZnVsbCB0YWJsZS4AAAAAAAAAAAALQm91bnR5RXJyb3IAAAAAEwAAAAAAAAARRGVhZGxpbmVOb3RQYXNzZWQAAAAAAAABAAAAAAAAABBBbHJlYWR5UHJvY2Vzc2VkAAAAAgAAAAAAAAATSW5zdWZmaWNpZW50QmFsYW5jZQAAAAADAAAATkJvdW50eSBidWRnZXQgZXhjZWVkcyB0aGUgbXVsdGktc2lnIHRocmVzaG9sZCBhbmQgbm8gc2lnbmVyIHNldCBpcyBjb25maWd1cmVkLgAAAAAAFU11bHRpc2lnTm90Q29uZmlndXJlZAAAAAAAAAQAAABKRmV3ZXIgc2lnbmVycyBhdXRob3Jpc2VkIHRoYW4gdGhlIHJlcXVpcmVkIG1pbmltdW0gKE0tb2YtTiBub3Qgc2F0aXNmaWVkKS4AAAAAABNJbnN1ZmZpY2llbnRTaWduZXJzAAAAAAUAAABMQ29uc3RydWN0b3IgZm91bmQgYW4gYWRtaW4gYWxyZWFkeSBzdG9yZWQgKGNhbm5vdCBoYXBwZW4gb24gYSBmcmVzaCBkZXBsb3kpLgAAABJBbHJlYWR5SW5pdGlhbGl6ZWQAAAAAAAYAAABNQW4gYWRtaW4tZ2F0ZWQgbWV0aG9kIGZvdW5kIG5vIHN0b3JlZCBhZG1pbiAobGVnYWN5IGRlcGxveSBub3QgeWV0IG1pZ3JhdGVkKS4AAAAAAAALQWRtaW5Ob3RTZXQAAAAABwAAAChDYWxsZXIgaXMgbm90IHRoZSBzdG9yZWQgY29udHJhY3QgYWRtaW4uAAAADFVuYXV0aG9yaXplZAAAAAgAAAA9YGNyZWF0ZV9hbmRfZnVuZF9ib3VudHlgIGNhbGxlZCBiZWZvcmUgYHNldF9lc2Nyb3dfY29udHJhY3RgLgAAAAAAABRFc2Nyb3dDb250cmFjdE5vdFNldAAAAAkAAAAAAAAADkJvdW50eU5vdEZvdW5kAAAAAAAKAAAAAAAAABNBcHBsaWNhdGlvbk5vdEZvdW5kAAAAAAsAAAAuVGhlIGFwcGxpY2F0aW9uIGJlbG9uZ3MgdG8gYSBkaWZmZXJlbnQgYm91bnR5LgAAAAAAE0FwcGxpY2F0aW9uTWlzbWF0Y2gAAAAADAAAADlUaGUgYm91bnR5IGlzIG5vdCBpbiB0aGUgc3RhdHVzIHRoaXMgdHJhbnNpdGlvbiByZXF1aXJlcy4AAAAAAAANSW52YWxpZFN0YXR1cwAAAAAAAA0AAAAzT25seSB0aGUgc2VsZWN0ZWQgZnJlZWxhbmNlciBtYXkgc3VibWl0IGNvbXBsZXRpb24uAAAAABVOb3RTZWxlY3RlZEZyZWVsYW5jZXIAAAAAAAAOAAAAP2ByZXF1aXJlZGAgaXMgMCBvciBleGNlZWRzIHRoZSBzaWduZXIgY291bnQsIG9yIHRocmVzaG9sZCA8PSAwLgAAAAAVSW52YWxpZE11bHRpc2lnQ29uZmlnAAAAAAAADwAAADpBbiBhcHByb3ZlciBpcyBub3QgaW4gdGhlIGNvbmZpZ3VyZWQgbXVsdGktc2lnIHNpZ25lciBzZXQuAAAAAAARQXBwcm92ZXJOb3RTaWduZXIAAAAAAAAQAAAAKVRoZSBzYW1lIGFwcHJvdmVyIGFwcGVhcnMgbW9yZSB0aGFuIG9uY2UuAAAAAAAAEUR1cGxpY2F0ZUFwcHJvdmVyAAAAAAAAEQAAAC8jMTcxNDogdGhlIGJvdW50eSBhbHJlYWR5IGhhcyBhbiBlc2Nyb3cgbGlua2VkLgAAAAATRXNjcm93QWxyZWFkeUxpbmtlZAAAAAASAAAAdiMxNzE0OiBgY2hlY2tfYW5kX2V4cGlyZV9ib3VudHlgIHdhcyBnaXZlbiBhbiBlc2Nyb3cgY29udHJhY3Qgb3RoZXIKdGhhbiB0aGUgb25lIHJlZ2lzdGVyZWQgdmlhIGBzZXRfZXNjcm93X2NvbnRyYWN0YC4AAAAAABZFc2Nyb3dDb250cmFjdE1pc21hdGNoAAAAAAAT", "AAAAAwAAABJCb3VudHkgU3RhdHVzIEVudW0AAAAAAAAAAAAMQm91bnR5U3RhdHVzAAAABgAAAAAAAAAET3BlbgAAAAAAAAAAAAAACkluUHJvZ3Jlc3MAAAAAAAEAAAAAAAAACUNvbXBsZXRlZAAAAAAAAAIAAAAAAAAACERpc3B1dGVkAAAAAwAAAAAAAAAJQ2FuY2VsbGVkAAAAAAAABAAAAAAAAAARUGVuZGluZ0NvbXBsZXRpb24AAAAAAAAF", "AAAAAAAAABtUaGUgY3VycmVudCBjb250cmFjdCBhZG1pbi4AAAAACWdldF9hZG1pbgAAAAAAAAAAAAABAAAD6QAAABMAAAfQAAAAC0JvdW50eUVycm9yAA==", "AAAAAQAAABlCb3VudHkgQXBwbGljYXRpb24gU3RydWN0AAAAAAAAAAAAABFCb3VudHlBcHBsaWNhdGlvbgAAAAAAAAgAAAAAAAAACWJvdW50eV9pZAAAAAAAAAYAAAAAAAAACmNyZWF0ZWRfYXQAAAAAAAYAAAAAAAAACmZyZWVsYW5jZXIAAAAAABMAAAAAAAAAAmlkAAAAAAAGAAAAAAAAAAhwcm9wb3NhbAAAABAAAAAAAAAAD3Byb3Bvc2VkX2J1ZGdldAAAAAALAAAAAAAAAAZzdGF0dXMAAAAAABAAAAAAAAAACHRpbWVsaW5lAAAABg==", "AAAAAAAAAAAAAAAKZ2V0X2JvdW50eQAAAAAAAQAAAAAAAAAJYm91bnR5X2lkAAAAAAAABgAAAAEAAAPpAAAH0AAAAAZCb3VudHkAAAAAB9AAAAALQm91bnR5RXJyb3IA", "AAAAAAAAATFMaW5rIGFuIGVzY3JvdyB0aGUgY3JlYXRvciBkZXBvc2l0ZWQgZGlyZWN0bHkgKHdpdGggYGJvdW50eV9pZGApIHRvIHRoZQpib3VudHkuICMxNzE0OiBvbmx5IHdoaWxlIHRoZSBib3VudHkgaXMgT3BlbiBhbmQgdW5saW5rZWQ7IHRoZSBlc2Nyb3cKY29udHJhY3QgdmVyaWZpZXMgdGhlIGVzY3JvdyBpcyBBY3RpdmUsIGJlbG9uZ3MgdG8gdGhpcyBib3VudHkgYW5kIHdhcwpwYWlkIGJ5IHRoZSBjcmVhdG9yLCBhbmQgYmluZHMgaXQgc28gaXQgY2FuIG9ubHkgYmUgcmVsZWFzZWQvcmVmdW5kZWQKdGhyb3VnaCB0aGlzIGNvbnRyYWN0LgAAAAAAAAtsaW5rX2VzY3JvdwAAAAACAAAAAAAAAAlib3VudHlfaWQAAAAAAAAGAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAGAAAAAQAAA+kAAAABAAAH0AAAAAtCb3VudHlFcnJvcgA=", "AAAAAAAAAFxBY2NlcHQgYSBub21pbmF0aW9uIChzdGVwIDIgb2YgMikuIE11c3QgYmUgc2lnbmVkIGJ5IHRoZSBub21pbmVlLgpFbWl0cyBgKGFkbWluLCBhY2NlcHRlZClgLgAAAAxhY2NlcHRfYWRtaW4AAAABAAAAAAAAAAluZXdfYWRtaW4AAAAAAAATAAAAAA==", "AAAAAAAAARtDb25zdHJ1Y3RvciAocHJvdG9jb2wgMjIrKS4gU2V0cyB0aGUgc2luZ2xlIGFkbWluIGtleSAoYGJvdW50eV9hZG1pbmApCmF0b21pY2FsbHkgaW5zaWRlIHRoZSBkZXBsb3kgdHJhbnNhY3Rpb24sIHNvIHRoZXJlIGlzIG5vIHdpbmRvdyBpbgp3aGljaCBhIHRoaXJkIHBhcnR5IGNhbiBjbGFpbSB0aGUgY29udHJhY3QgKGlzc3VlICMxNzA4KS4gTGF0ZXIgY2hhbmdlcwpnbyB0aHJvdWdoIGBwcm9wb3NlX2FkbWluYCAvIGBhY2NlcHRfYWRtaW5gLiBFbWl0cyBgKGJvdW50eSwgYWRtaW5fc2V0KWAuAAAAAA1fX2NvbnN0cnVjdG9yAAAAAAAAAQAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAA==", "AAAAAAAAAAAAAAANY2FuY2VsX2JvdW50eQAAAAAAAAEAAAAAAAAACWJvdW50eV9pZAAAAAAAAAYAAAABAAAD6QAAAAEAAAfQAAAAC0JvdW50eUVycm9yAA==", "AAAAAAAAAAAAAAANY3JlYXRlX2JvdW50eQAAAAAAAAUAAAAAAAAAB2NyZWF0b3IAAAAAEwAAAAAAAAAFdGl0bGUAAAAAAAAQAAAAAAAAAAtkZXNjcmlwdGlvbgAAAAAQAAAAAAAAAAZidWRnZXQAAAAAAAsAAAAAAAAACGRlYWRsaW5lAAAABgAAAAEAAAAG", "AAAAAAAAAEpOb21pbmF0ZSBhIG5ldyBhZG1pbiAoc3RlcCAxIG9mIDIpLiBBZG1pbi1vbmx5LiBFbWl0cyBgKGFkbWluLCBwcm9wb3NlZClgLgAAAAAADXByb3Bvc2VfYWRtaW4AAAAAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAACW5ld19hZG1pbgAAAAAAABMAAAAA", "AAAAAAAAAEdXaXRoZHJhdyB0aGUgcGVuZGluZyB1cGdyYWRlLiBBZG1pbi1vbmx5LiBFbWl0cyBgKHVwZ3JhZGUsIGNhbmNlbGxlZClgLgAAAAAOY2FuY2VsX3VwZ3JhZGUAAAAAAAEAAAAAAAAABWFkbWluAAAAAAAAEwAAAAA=", "AAAAAAAAAlFBcHByb3ZlIGNvbXBsZXRpb24gYW5kIHJlbGVhc2UgcGF5bWVudC4gRW1pdHMgYCgiYm91bnR5IiwgImNvbXBsZXRlZCIpYCDigJQKdGhpcyBpcyB0aGUgImFwcHJvdmVkIiB0cmFuc2l0aW9uIGluIGRvY3MvY29udHJhY3RzLm1kLgoKYGFwcHJvdmVyc2AgbmFtZXMgdGhlIG11bHRpLXNpZyBzaWduZXJzIGF1dGhvcmlzaW5nIHRoaXMgY2FsbC4gSXQgaXMKaWdub3JlZCBmb3IgYm91bnRpZXMgYmVsb3cgdGhlIG11bHRpLXNpZyB0aHJlc2hvbGQg4oCUIHBhc3MgYW4gZW1wdHkKYFZlY2AgZm9yIHRob3NlLiBBYm92ZSB0aGUgdGhyZXNob2xkIGl0IG11c3QgY29udGFpbiBhdCBsZWFzdApgcmVxdWlyZWRgIGRpc3RpbmN0IGFkZHJlc3NlcywgYWxsIGRyYXduIGZyb20gdGhlIGNvbmZpZ3VyZWQgc2lnbmVyCnNldCwgYW5kIGVhY2ggbXVzdCBoYXZlIGF1dGhvcmlzZWQgdGhlIGludm9jYXRpb24uCgpBbnkgYHJlcXVpcmVkYC1zaXplZCBzdWJzZXQgc2F0aXNmaWVzIHRoZSBwb2xpY3k7IHRoZSBzaWduZXJzIG5vIGxvbmdlcgpoYXZlIHRvIGJlIHRoZSBmaXJzdCBgcmVxdWlyZWRgIGVudHJpZXMgaW4gdGhlIHN0b3JlZCBvcmRlciAoIzExMTMpLgAAAAAAAA9jb21wbGV0ZV9ib3VudHkAAAAAAgAAAAAAAAAJYm91bnR5X2lkAAAAAAAABgAAAAAAAAAJYXBwcm92ZXJzAAAAAAAD6gAAABMAAAABAAAD6QAAAAEAAAfQAAAAC0JvdW50eUVycm9yAA==", "AAAAAAAAAGJBcHBseSB0aGUgcGVuZGluZyB1cGdyYWRlIG9uY2UgaXRzIHRpbWVsb2NrIGhhcyBlbGFwc2VkLiBBZG1pbi1vbmx5LgpFbWl0cyBgKGNvbnRyYWN0LCB1cGdyYWRlZClgLgAAAAAAD2V4ZWN1dGVfdXBncmFkZQAAAAABAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAA", "AAAAAAAAAAAAAAAPZ2V0X2FwcGxpY2F0aW9uAAAAAAEAAAAAAAAADmFwcGxpY2F0aW9uX2lkAAAAAAAGAAAAAQAAA+kAAAfQAAAAEUJvdW50eUFwcGxpY2F0aW9uAAAAAAAH0AAAAAtCb3VudHlFcnJvcgA=", "AAAAAAAAAJZQcm9wb3NlIGEgV0FTTSB1cGdyYWRlLiBBZG1pbi1vbmx5LiBSZXR1cm5zIHRoZSBsZWRnZXIgdGltZXN0YW1wIGFmdGVyCndoaWNoIGBleGVjdXRlX3VwZ3JhZGVgIG1heSBiZSBjYWxsZWQgKG5vdyArIDQ4aCkuIEVtaXRzCmAodXBncmFkZSwgcHJvcG9zZWQpYC4AAAAAAA9wcm9wb3NlX3VwZ3JhZGUAAAAAAgAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAA1uZXdfd2FzbV9oYXNoAAAAAAAD7gAAACAAAAABAAAABg==", "AAAAAAAAAAAAAAAQYXBwbHlfZm9yX2JvdW50eQAAAAUAAAAAAAAACWJvdW50eV9pZAAAAAAAAAYAAAAAAAAACmZyZWVsYW5jZXIAAAAAABMAAAAAAAAACHByb3Bvc2FsAAAAEAAAAAAAAAAPcHJvcG9zZWRfYnVkZ2V0AAAAAAsAAAAAAAAACHRpbWVsaW5lAAAABgAAAAEAAAAG", "AAAAAAAAAAAAAAAQZ2V0X2FwcGxpY2F0aW9ucwAAAAEAAAAAAAAACWJvdW50eV9pZAAAAAAAAAYAAAABAAAD6gAAB9AAAAARQm91bnR5QXBwbGljYXRpb24AAAA=", "AAAAAAAAAHsjMTcxNDogaW52YXJpYW50IGNoZWNrIOKAlCB0cnVlIHdoZW4gdGhlIGJvdW50eSBhbmQgaXRzIGxpbmtlZCBlc2Nyb3cKYXJlIGluIGEgdmFsaWQgam9pbnQgc3RhdGUgKHNlZSBgam9pbnRfc3RhdGVfdmFsaWRgKS4AAAAAEWNoZWNrX2pvaW50X3N0YXRlAAAAAAAAAQAAAAAAAAAJYm91bnR5X2lkAAAAAAAABgAAAAEAAAPpAAAAAQAAB9AAAAALQm91bnR5RXJyb3IA", "AAAAAAAAADFUaGUgbm9taW5hdGVkLWJ1dC1ub3QteWV0LWFjY2VwdGVkIGFkbWluLCBpZiBhbnkuAAAAAAAAEWdldF9wZW5kaW5nX2FkbWluAAAAAAAAAAAAAAEAAAPoAAAAEw==", "AAAAAAAAAV9PbmUtb2ZmIG1pZ3JhdGlvbiBmb3IgY29udHJhY3RzIGRlcGxveWVkIGJlZm9yZSAjMTcwOCB0aGF0IHN0aWxsIGhvbGQKdGhlaXIgYWRtaW4gdW5kZXIgdGhlIGxlZ2FjeSBgYWRtaW5gIGtleS4gTW92ZXMgaXQgaW50byB0aGUgY2Fub25pY2FsCmBib3VudHlfYWRtaW5gIGtleSBhbmQgZGVsZXRlcyB0aGUgbGVnYWN5IGVudHJ5IHNvIHRoZXJlIGlzIGV4YWN0bHkgb25lCnNvdXJjZSBvZiB0cnV0aC4gTXVzdCBiZSBzaWduZWQgYnkgdGhlIGxlZ2FjeSBhZG1pbi4gTm8tb3AgKHJldHVybnMKYGZhbHNlYCkgd2hlbiB0aGVyZSBpcyBub3RoaW5nIHRvIG1pZ3JhdGUuIEVtaXRzIGAoYm91bnR5LCBhZG1pbl9taWcpYC4AAAAAEW1pZ3JhdGVfYWRtaW5fa2V5AAAAAAAAAAAAAAEAAAPpAAAAAQAAB9AAAAALQm91bnR5RXJyb3IA", "AAAAAAAAAH1Bc3NpZ24gdGhlIGJvdW50eSB0byBhbiBhcHBsaWNhbnQuIEVtaXRzIGAoImJvdW50eSIsICJzZWxlY3RlZCIpYCDigJQKdGhpcyBpcyB0aGUgImFzc2lnbmVkIiB0cmFuc2l0aW9uIGluIGRvY3MvY29udHJhY3RzLm1kLgAAAAAAABFzZWxlY3RfZnJlZWxhbmNlcgAAAAAAAAIAAAAAAAAACWJvdW50eV9pZAAAAAAAAAYAAAAAAAAADmFwcGxpY2F0aW9uX2lkAAAAAAAGAAAAAQAAA+kAAAABAAAH0AAAAAtCb3VudHlFcnJvcgA=", "AAAAAAAAALVDYWxsZWQgYnkgdGhlIHNlbGVjdGVkIGZyZWVsYW5jZXIgdG8gc2lnbmFsIHdvcmsgaXMgZG9uZS4KVHJhbnNpdGlvbnMgdGhlIGJvdW50eSBmcm9tIEluUHJvZ3Jlc3Mg4oaSIFBlbmRpbmdDb21wbGV0aW9uLiAoIzE2MCkKVGhlIGNyZWF0b3IgbXVzdCB0aGVuIGNhbGwgY29tcGxldGVfYm91bnR5IHRvIGFwcHJvdmUuAAAAAAAAEXN1Ym1pdF9jb21wbGV0aW9uAAAAAAAAAgAAAAAAAAAJYm91bnR5X2lkAAAAAAAABgAAAAAAAAAKZnJlZWxhbmNlcgAAAAAAEwAAAAEAAAPpAAAAAQAAB9AAAAALQm91bnR5RXJyb3IA", "AAAAAAAAAAAAAAASZ2V0X2JvdW50aWVzX2NvdW50AAAAAAAAAAAAAQAAAAY=", "AAAAAAAAADdUaGUgdXBncmFkZSBjdXJyZW50bHkgd2FpdGluZyBvdXQgaXRzIHRpbWVsb2NrLCBpZiBhbnkuAAAAABNnZXRfcGVuZGluZ191cGdyYWRlAAAAAAAAAAABAAAD6AAAB9AAAAAOUGVuZGluZ1VwZ3JhZGUAAA==", "AAAAAAAAAAAAAAATc2V0X2VzY3Jvd19jb250cmFjdAAAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAABmVzY3JvdwAAAAAAEwAAAAEAAAPpAAAAAQAAB9AAAAALQm91bnR5RXJyb3IA", "AAAAAAAAAPtUcnVlIHdoZW4gYGFjY291bnRgIGNvbXBsZXRlZCBhIGZ1bmRlZCBib3VudHk6IHRoZSBib3VudHkgaXMKYENvbXBsZXRlZGAsIHdhcyBmdW5kZWQgdGhyb3VnaCBlc2Nyb3cgKGBlc2Nyb3dfaWQgIT0gMGAsIGJ1ZGdldCA+IDApCmFuZCBgYWNjb3VudGAgaXMgaXRzIGNyZWF0b3Igb3Igc2VsZWN0ZWQgZnJlZWxhbmNlci4gUmVhZCBieSB0aGUKcmVmZXJyYWwgY29udHJhY3QgYmVmb3JlIHBheWluZyBhIHJld2FyZCAoaXNzdWUgIzE3MTYpLgAAAAAUaXNfcXVhbGlmeWluZ19ib3VudHkAAAACAAAAAAAAAAlib3VudHlfaWQAAAAAAAAGAAAAAAAAAAdhY2NvdW50AAAAABMAAAABAAAAAQ==", "AAAAAAAAAUxDb25maWd1cmUgdGhlIE0tb2YtTiBzaWduZXIgc2V0IGZvciBoaWdoLXZhbHVlIGJvdW50eSBwYXltZW50cy4KCk9ubHkgdGhlIHN0b3JlZCBjb250cmFjdCBhZG1pbiAoZ292ZXJuYW5jZSBtdWx0aXNpZykgbWF5IGNhbGwgdGhpcy4KYHNpZ25lcnNgIGlzIHRoZSBmdWxsIG9yZGVyZWQgbGlzdCBvZiBhdXRob3Jpc2VkIGFkZHJlc3NlczsgYHJlcXVpcmVkYAppcyB0aGUgbWluaW11bSBudW1iZXIgb2YgdGhlbSB0aGF0IG11c3QgY2FsbCBgcmVxdWlyZV9hdXRoKClgIGJlZm9yZQpgY29tcGxldGVfYm91bnR5YCBwcm9jZWVkcyBmb3IgYnVkZ2V0cyBhYm92ZSB0aGUgdGhyZXNob2xkLgAAABRzZXRfbXVsdGlzaWdfc2lnbmVycwAAAAMAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAHc2lnbmVycwAAAAPqAAAAEwAAAAAAAAAIcmVxdWlyZWQAAAAEAAAAAQAAA+kAAAABAAAH0AAAAAtCb3VudHlFcnJvcgA=", "AAAAAAAAAExXaXRoZHJhdyBhIHBlbmRpbmcgYWRtaW4gbm9taW5hdGlvbi4gQWRtaW4tb25seS4gRW1pdHMgYChhZG1pbiwgY2FuY2VsbGVkKWAuAAAAFWNhbmNlbF9hZG1pbl90cmFuc2ZlcgAAAAAAAAEAAAAAAAAABWFkbWluAAAAAAAAEwAAAAA=", "AAAAAAAAAAAAAAAWY3JlYXRlX2FuZF9mdW5kX2JvdW50eQAAAAAABgAAAAAAAAAHY3JlYXRvcgAAAAATAAAAAAAAAAV0aXRsZQAAAAAAABAAAAAAAAAAC2Rlc2NyaXB0aW9uAAAAABAAAAAAAAAABmJ1ZGdldAAAAAAACwAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAAAAAAhkZWFkbGluZQAAAAYAAAABAAAD6QAAAAYAAAfQAAAAC0JvdW50eUVycm9yAA==", "AAAAAAAAAHZPcHRpbWl6ZWQgdmlldzogcmV0dXJuIGFsbCBib3VudGllcyBtYXRjaGluZyBhIGdpdmVuIHN0YXR1cy4KQXZvaWRzIGxvYWRpbmcgYWxsIGJvdW50aWVzIHdoZW4gb25seSBhIHN1YnNldCBpcyBuZWVkZWQuAAAAAAAWZ2V0X2JvdW50aWVzX2J5X3N0YXR1cwAAAAAAAQAAAAAAAAAGc3RhdHVzAAAAAAfQAAAADEJvdW50eVN0YXR1cwAAAAEAAAPqAAAH0AAAAAZCb3VudHkAAA==", "AAAAAAAAAHBPcHRpbWl6ZWQgdmlldzogcmV0dXJuIGEgcGFnaW5hdGVkIHNsaWNlIG9mIGFsbCBib3VudGllcy4KYG9mZnNldGAgaXMgemVyby1iYXNlZDsgcmV0dXJucyBhdCBtb3N0IGBsaW1pdGAgaXRlbXMuAAAAFmdldF9ib3VudGllc19wYWdpbmF0ZWQAAAAAAAIAAAAAAAAABm9mZnNldAAAAAAABgAAAAAAAAAFbGltaXQAAAAAAAAGAAAAAQAAA+oAAAfQAAAABkJvdW50eQAA", "AAAAAAAAAEhSZXR1cm4gdGhlIGNvbmZpZ3VyZWQgbXVsdGktc2lnIHRocmVzaG9sZCAob3IgdGhlIGNvbXBpbGUtdGltZSBkZWZhdWx0KS4AAAAWZ2V0X211bHRpc2lnX3RocmVzaG9sZAAAAAAAAAAAAAEAAAAL", "AAAAAAAAAGVVcGRhdGUgdGhlIGJ1ZGdldCB0aHJlc2hvbGQgYWJvdmUgd2hpY2ggbXVsdGktc2lnIGlzIGVuZm9yY2VkLgpPbmx5IHRoZSBjb250cmFjdCBhZG1pbiBtYXkgY2FsbCB0aGlzLgAAAAAAABZzZXRfbXVsdGlzaWdfdGhyZXNob2xkAAAAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAACXRocmVzaG9sZAAAAAAAAAsAAAABAAAD6QAAAAEAAAfQAAAAC0JvdW50eUVycm9yAA==", "AAAAAAAAAAAAAAAXY2hlY2tfYW5kX2V4cGlyZV9ib3VudHkAAAAAAgAAAAAAAAAJYm91bnR5X2lkAAAAAAAABgAAAAAAAAAPZXNjcm93X2NvbnRyYWN0AAAAABMAAAABAAAD6QAAAAEAAAfQAAAAC0JvdW50eUVycm9yAA==", "AAAAAAAAAQlFc3RpbWF0ZSB0aGUgdG90YWwgZmVlIGZvciBjcmVhdGluZyBhIGJvdW50eSB3aXRoIHRoZSBnaXZlbiBidWRnZXQuClJldHVybnM6IHBsYXRmb3JtX2ZlZSArIGJhc2VfcmVzb3VyY2VfZmVlCgpOb3RlOiBhY3R1YWwgZmVlIG1heSB2YXJ5IGJ5IHVwIHRvIDEwJSBmcm9tIHRoaXMgZXN0aW1hdGUgZHVlIHRvIG5ldHdvcmsgY29uZGl0aW9ucy4KVGhlIGVzdGltYXRlIGlzIGd1YXJhbnRlZWQgbm90IHRvIGV4Y2VlZCBhY3R1YWwgZmVlIGJ5IG1vcmUgdGhhbiAxMCUuAAAAAAAAGmVzdGltYXRlX2NyZWF0ZV9ib3VudHlfZmVlAAAAAAABAAAAAAAAAAZidWRnZXQAAAAAAAsAAAABAAAACw==", "AAAABAAAAK1FcnJvcnMgcmFpc2VkIGJ5IHRoZSBzaGFyZWQgdXBncmFkZS9hZG1pbiBoZWxwZXJzLgoKQ29kZXMgc3RhcnQgYXQgOTAwIHNvIHRoZXkgZG9uJ3Qgb3ZlcmxhcCBhbnkgY29udHJhY3QncyBvd24gZXJyb3IgZW51bTsKdGhleSBzdXJmYWNlIG9uLWNoYWluIGFzIGBFcnJvcihDb250cmFjdCwgIzl4eClgLgAAAAAAAAAAAAAMVXBncmFkZUVycm9yAAAABgAAAB9DYWxsZXIgaXMgbm90IHRoZSBzdG9yZWQgYWRtaW4uAAAAAAxVbmF1dGhvcml6ZWQAAAOEAAAAQWBleGVjdXRlX3VwZ3JhZGVgIC8gYGNhbmNlbF91cGdyYWRlYCBjYWxsZWQgd2l0aCBub3RoaW5nIHBlbmRpbmcuAAAAAAAAEE5vUGVuZGluZ1VwZ3JhZGUAAAOFAAAAMGBleGVjdXRlX3VwZ3JhZGVgIGNhbGxlZCBiZWZvcmUgYGV4ZWN1dGFibGVfYXRgLgAAABJUaW1lbG9ja05vdEVsYXBzZWQAAAAAA4YAAABFYGFjY2VwdF9hZG1pbmAgLyBgY2FuY2VsX2FkbWluX3RyYW5zZmVyYCBjYWxsZWQgd2l0aCBub3RoaW5nIHBlbmRpbmcuAAAAAAAADk5vUGVuZGluZ0FkbWluAAAAAAOHAAAAO2BhY2NlcHRfYWRtaW5gIHNpZ25lZCBieSBhbiBhZGRyZXNzIG90aGVyIHRoYW4gdGhlIG5vbWluZWUuAAAAAA9Ob3RQZW5kaW5nQWRtaW4AAAADiAAAACxgcHJvcG9zZV9hZG1pbmAgbm9taW5hdGVkIHRoZSBjdXJyZW50IGFkbWluLgAAAAlTYW1lQWRtaW4AAAAAAAOJ", "AAAAAQAAADFBIHByb3Bvc2VkIGNvZGUgdXBncmFkZSB3YWl0aW5nIG91dCBpdHMgdGltZWxvY2suAAAAAAAAAAAAAA5QZW5kaW5nVXBncmFkZQAAAAAAAwAAAAAAAAANZXhlY3V0YWJsZV9hdAAAAAAAAAYAAAAAAAAAC3Byb3Bvc2VkX2F0AAAAAAYAAAAAAAAACXdhc21faGFzaAAAAAAAA+4AAAAg"]),
      options
    );
  }

   static deploy<T = Client>({ admin }: { admin: string | Address }, options: MethodOptions & Omit<ContractClientOptions, 'contractId'> & { wasmHash: Buffer | string; salt?: Buffer | Uint8Array; format?: "hex" | "base64"; address?: string; }): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({ admin }, options);
  }
  public readonly fromJSON = {
    get_admin : this.txFromJSON<Result<string, BountyError>>,  get_bounty : this.txFromJSON<Result<Bounty, BountyError>>,  link_escrow : this.txFromJSON<Result<boolean, BountyError>>,  accept_admin : this.txFromJSON<void>,  cancel_bounty : this.txFromJSON<Result<boolean, BountyError>>,  create_bounty : this.txFromJSON<bigint>,  propose_admin : this.txFromJSON<void>,  cancel_upgrade : this.txFromJSON<void>,  complete_bounty : this.txFromJSON<Result<boolean, BountyError>>,  execute_upgrade : this.txFromJSON<void>,  get_application : this.txFromJSON<Result<BountyApplication, BountyError>>,  propose_upgrade : this.txFromJSON<bigint>,  apply_for_bounty : this.txFromJSON<bigint>,  get_applications : this.txFromJSON<Array<BountyApplication>>,  check_joint_state : this.txFromJSON<Result<boolean, BountyError>>,  get_pending_admin : this.txFromJSON<string | null>,  migrate_admin_key : this.txFromJSON<Result<boolean, BountyError>>,  select_freelancer : this.txFromJSON<Result<boolean, BountyError>>,  submit_completion : this.txFromJSON<Result<boolean, BountyError>>,  get_bounties_count : this.txFromJSON<bigint>,  get_pending_upgrade : this.txFromJSON<PendingUpgrade | null>,  set_escrow_contract : this.txFromJSON<Result<boolean, BountyError>>,  is_qualifying_bounty : this.txFromJSON<boolean>,  set_multisig_signers : this.txFromJSON<Result<boolean, BountyError>>,  cancel_admin_transfer : this.txFromJSON<void>,  create_and_fund_bounty : this.txFromJSON<Result<bigint, BountyError>>,  get_bounties_by_status : this.txFromJSON<Array<Bounty>>,  get_bounties_paginated : this.txFromJSON<Array<Bounty>>,  get_multisig_threshold : this.txFromJSON<bigint>,  set_multisig_threshold : this.txFromJSON<Result<boolean, BountyError>>,  check_and_expire_bounty : this.txFromJSON<Result<boolean, BountyError>>,  estimate_create_bounty_fee : this.txFromJSON<bigint>
  };

}