import {GovernanceConfig, Proposal, ExecutionTimelock, TokenVote, PendingUpgrade, ProposalParam} from './types';
import {Spec, AssembledTransaction, Client as ContractClient, ClientOptions as ContractClientOptions, MethodOptions} from '@stellar/stellar-sdk/contract';
import {Address} from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';

export interface Client {
  vote({ voter, proposal_id, vote_yes }: { voter: string | Address; proposal_id: bigint; vote_yes: boolean }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  /**
   * Current voting power of `account`.
   */
  get_votes({ account }: { account: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  get_config(options?: MethodOptions): Promise<AssembledTransaction<GovernanceConfig>>;
  /**
   * One-time constructor: sets the external admin and default governance parameters.
   */
  initialize({ admin }: { admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Check if an address is a guardian.
   */
  is_guardian({ addr }: { addr: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  /**
   * Accept a nomination (step 2 of 2). Must be signed by the nominee.
   * Emits `(admin, accepted)`.
   */
  accept_admin({ new_admin }: { new_admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Add a guardian address that can veto queued proposals.
   * Only the admin can add guardians.
   */
  add_guardian({ admin, guardian }: { admin: string | Address; guardian: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  get_proposal({ proposal_id }: { proposal_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Proposal>>;
  /**
   * Retrieve the execution timelock for a queued proposal.
   */
  get_timelock({ proposal_id }: { proposal_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<ExecutionTimelock>>;
  /**
   * Lock `amount` governance tokens in this contract to gain voting power.
   * Power counts only for proposals created in a later ledger.
   */
  deposit_votes({ account, amount }: { account: string | Address; amount: bigint }, options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  /**
   * Nominate a new admin (step 1 of 2). Admin-only. Emits `(admin, proposed)`.
   */
  propose_admin({ admin, new_admin }: { admin: string | Address; new_admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Veto a queued proposal. Only guardians can veto.
   * Removes the timelock and marks the proposal as rejected.
   */
  veto_proposal({ guardian, proposal_id }: { guardian: string | Address; proposal_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Cast a token-weighted vote on a proposal.
   *
   * The vote weight is the voter's checkpointed voting power at the
   * proposal's snapshot ledger (Issue #1565) — tokens deposited or
   * transferred in after the proposal was created carry no weight on it.
   * Previously the caller supplied the weight directly, which let anyone
   * claim arbitrary power or vote with briefly borrowed tokens.
   */
  vote_weighted({ voter, proposal_id, vote_yes }: { voter: string | Address; proposal_id: bigint; vote_yes: boolean }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  /**
   * Withdraw the pending upgrade. Admin-only. Emits `(upgrade, cancelled)`.
   */
  cancel_upgrade({ admin }: { admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Voting power of `account` as of the end of `ledger`.
   */
  get_past_votes({ account, ledger }: { account: string | Address; ledger: number }, options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  /**
   * Retrieve the weighted vote record for a specific voter on a proposal.
   */
  get_token_vote({ proposal_id, voter }: { proposal_id: bigint; voter: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<TokenVote>>;
  /**
   * Unlock `amount` governance tokens. Votes already cast are unaffected
   * (they used the snapshot), and the withdrawn tokens can't be re-used on
   * any proposal whose snapshot predates a later re-deposit.
   */
  withdraw_votes({ account, amount }: { account: string | Address; amount: bigint }, options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  create_proposal({ proposer, title, description, voting_period }: { proposer: string | Address; title: string; description: string; voting_period: bigint }, options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
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
   * Queue an approved proposal for timelocked execution.
   *
   * `timelock_delay` is in seconds.  The proposal must already be in
   * "approved" status (i.e. `execute_proposal` has been called).
   */
  queue_execution({ proposal_id, timelock_delay }: { proposal_id: bigint; timelock_delay: bigint }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Remove a guardian. Only the admin can remove guardians.
   */
  remove_guardian({ admin, guardian }: { admin: string | Address; guardian: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  execute_proposal({ proposal_id }: { proposal_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  /**
   * The governance token, if configured.
   */
  get_voting_token(options?: MethodOptions): Promise<AssembledTransaction<string | null>>;
  set_platform_fee({ admin, fee_percent }: { admin: string | Address; fee_percent: number }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  /**
   * Set the governance token whose deposits confer voting power. Admin-only
   * and set-once: swapping the token would invalidate existing checkpoints.
   */
  set_voting_token({ admin, token }: { admin: string | Address; token: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Finalize a proposal after its voting deadline, enforcing quorum.
   *
   * Requires `(yes_votes + no_votes) * 100 / total >= quorum_percent`, where
   * `total` and `quorum_percent` were frozen when the proposal was created
   * (Issue #1710). Panics if quorum is not met, voting is still open, no
   * power was deposited at the snapshot, or the proposal predates #1710 and
   * has not been through `migrate_proposal_quorum`.
   */
  finalize_proposal({ proposal_id }: { proposal_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  /**
   * The nominated-but-not-yet-accepted admin, if any.
   */
  get_pending_admin(options?: MethodOptions): Promise<AssembledTransaction<string | null>>;
  set_bounty_limits({ admin, min_budget, max_budget }: { admin: string | Address; min_budget: bigint; max_budget: bigint }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  /**
   * Execute a timelocked proposal after its delay has elapsed.
   *
   * If the proposal carries a `ProposalParam` (stored via
   * `create_param_proposal`), the governance config is updated on-chain.
   */
  execute_timelocked({ proposal_id }: { proposal_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  /**
   * Get the current quorum threshold. Defaults to 10%.
   */
  get_quorum_percent(options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  /**
   * Set the quorum threshold (0–100). Only admin can update.
   */
  set_quorum_percent({ admin, quorum_percent }: { admin: string | Address; quorum_percent: bigint }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Keeper entrypoint (Issue #1720): extend the contract instance, the
   * shared config/counter entries and every per-proposal entry for
   * `proposal_ids` that still exists. Permissionless; it only pays rent.
   * Returns how many proposals were found. At most `MAX_KEEPER_BATCH` ids.
   */
  extend_proposal_ttl({ proposal_ids }: { proposal_ids: Array<bigint> }, options?: MethodOptions): Promise<AssembledTransaction<number>>;
  /**
   * The upgrade currently waiting out its timelock, if any.
   */
  get_pending_upgrade(options?: MethodOptions): Promise<AssembledTransaction<PendingUpgrade | null>>;
  /**
   * Quorum inputs frozen for `proposal_id` at creation:
   * `(total_voting_power_at_snapshot, quorum_percent)`.
   */
  get_proposal_quorum({ proposal_id }: { proposal_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<[bigint, bigint]>>;
  /**
   * Withdraw a pending admin nomination. Admin-only. Emits `(admin, cancelled)`.
   */
  cancel_admin_transfer({ admin }: { admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Create a proposal that carries an on-chain parameter change.
   *
   * Combines `create_proposal` with attaching a `ProposalParam` so that
   * on approval + timelock expiry the config updates atomically without any
   * further admin transaction.
   */
  create_param_proposal({ proposer, title, description, voting_period, param }: { proposer: string | Address; title: string; description: string; voting_period: bigint; param: ProposalParam }, options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  /**
   * Ledger at which voting power is measured for `proposal_id`.
   */
  get_proposal_snapshot({ proposal_id }: { proposal_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<number>>;
  /**
   * Get the current timelock duration. Defaults to 48 hours.
   */
  get_timelock_duration(options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  /**
   * Set the default timelock duration (in seconds). Only admin can change.
   */
  set_timelock_duration({ admin, duration_secs }: { admin: string | Address; duration_secs: bigint }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Current total deposited voting power (Issue #1710).
   *
   * This used to be an admin-set number. It is now the sum of all
   * `deposit_votes` minus `withdraw_votes`, checkpointed per ledger.
   * Saturates at `u64::MAX` to keep the existing return type.
   */
  get_total_voting_power(options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  /**
   * One-time migration for proposals created before Issue #1710.
   *
   * Permissionless: it only records values that are already determined.
   * The total is read at the proposal's voting snapshot ledger when it has
   * one (Issue #1565), otherwise at the ledger before this call; the quorum
   * percentage is the one in force now. It also deletes the obsolete
   * admin-set `total_vp` entry. Fails if the proposal is already migrated
   * or no longer pending.
   */
  migrate_proposal_quorum({ proposal_id }: { proposal_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<[bigint, bigint]>>;
  /**
   * Queue an approved proposal using the configured default timelock.
   */
  queue_execution_default({ proposal_id }: { proposal_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Total deposited voting power as of the end of `ledger`.
   */
  get_past_total_voting_power({ ledger }: { ledger: number }, options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
}

export class Client extends ContractClient {
  constructor(public readonly options: ContractClientOptions) {
    super(
      new Spec(["AAAAAQAAAAhQcm9wb3NhbAAAAAAAAAAIUHJvcG9zYWwAAAAJAAAAAAAAAApjcmVhdGVkX2F0AAAAAAAGAAAAAAAAAAtkZXNjcmlwdGlvbgAAAAAQAAAAAAAAAAJpZAAAAAAABgAAAAAAAAAIbm9fdm90ZXMAAAAGAAAAAAAAAAhwcm9wb3NlcgAAABMAAAAAAAAABnN0YXR1cwAAAAAAEAAAAAAAAAAFdGl0bGUAAAAAAAAQAAAAAAAAAA92b3RpbmdfZGVhZGxpbmUAAAAABgAAAAAAAAAJeWVzX3ZvdGVzAAAAAAAABg==", "AAAAAQAAAOlXZWlnaHRlZCB2b3RlIGNhc3QgYnkgYSB0b2tlbiBob2xkZXIuCgpgd2VpZ2h0YCBpcyB0aGUgdm90ZXIncyBjaGVja3BvaW50ZWQgdm90aW5nIHBvd2VyIGF0IHRoZSBwcm9wb3NhbCdzCnNuYXBzaG90IGxlZGdlciAoSXNzdWUgIzE1NjUpLCBpbiB0aGUgdm90aW5nIHRva2VuJ3Mgc21hbGxlc3QKZGVub21pbmF0aW9uLiBJdCBpcyByZWFkIG9uLWNoYWluLCBuZXZlciBzdXBwbGllZCBieSB0aGUgY2FsbGVyLgAAAAAAAAAAAAAJVG9rZW5Wb3RlAAAAAAAABAAAAAAAAAALcHJvcG9zYWxfaWQAAAAABgAAAAAAAAAIdm90ZV95ZXMAAAABAAAAAAAAAAV2b3RlcgAAAAAAABMAAAAAAAAABndlaWdodAAAAAAABg==", "AAAAAQAAARFPcHRpb25hbCBvbi1jaGFpbiBwYXJhbWV0ZXIgY2hhbmdlIGF0dGFjaGVkIHRvIGEgcHJvcG9zYWwuCgpXaGVuIGEgcHJvcG9zYWwgY2FycmllcyBhIGBQcm9wb3NhbFBhcmFtYCwgYGV4ZWN1dGVfdGltZWxvY2tlZGAgYXBwbGllcwp0aGUgY2hhbmdlIGRpcmVjdGx5IHRvIHRoZSBnb3Zlcm5hbmNlIGNvbmZpZywgY3JlYXRpbmcgYSBmdWxseSBvbi1jaGFpbgpwYXJhbWV0ZXItdXBkYXRlIGZsb3cgd2l0aG91dCByZXF1aXJpbmcgYSBzZXBhcmF0ZSBhZG1pbiB0cmFuc2FjdGlvbi4AAAAAAAAAAAAADVByb3Bvc2FsUGFyYW0AAAAAAAADAAAANE5ldyBwbGF0Zm9ybSBmZWUgaW4gYmFzaXMgcG9pbnRzIChOb25lID0gbm8gY2hhbmdlKS4AAAAOdGFyZ2V0X2ZlZV9icHMAAAAAA+gAAAAEAAAALU5ldyBtYXhpbXVtIGJvdW50eSBidWRnZXQgKE5vbmUgPSBubyBjaGFuZ2UpLgAAAAAAABF0YXJnZXRfbWF4X2J1ZGdldAAAAAAAA+gAAAALAAAALU5ldyBtaW5pbXVtIGJvdW50eSBidWRnZXQgKE5vbmUgPSBubyBjaGFuZ2UpLgAAAAAAABF0YXJnZXRfbWluX2J1ZGdldAAAAAAAA+gAAAAL", "AAAAAAAAAAAAAAAEdm90ZQAAAAMAAAAAAAAABXZvdGVyAAAAAAAAEwAAAAAAAAALcHJvcG9zYWxfaWQAAAAABgAAAAAAAAAIdm90ZV95ZXMAAAABAAAAAQAAAAE=", "AAAAAQAAABhHb3Zlcm5hbmNlIENvbmZpZ3VyYXRpb24AAAAAAAAAEEdvdmVybmFuY2VDb25maWcAAAAGAAAAAAAAAA1hZG1pbl9hZGRyZXNzAAAAAAAAEwAAAAAAAAAZZGlzcHV0ZV9yZXNvbHV0aW9uX3BlcmlvZAAAAAAAAAYAAAAAAAAADGxhc3RfdXBkYXRlZAAAAAYAAAAAAAAAEW1heF9ib3VudHlfYnVkZ2V0AAAAAAAACwAAAAAAAAARbWluX2JvdW50eV9idWRnZXQAAAAAAAALAAAAAAAAABRwbGF0Zm9ybV9mZWVfcGVyY2VudAAAAAQ=", "AAAAAQAAANRFeGVjdXRpb24gdGltZWxvY2sgZm9yIGFuIGFwcHJvdmVkIHByb3Bvc2FsLgoKQW4gYXBwcm92ZWQgcHJvcG9zYWwgbXVzdCB3YWl0IGB1bmxvY2tfYXRgIChsZWRnZXIgdGltZXN0YW1wKSBiZWZvcmUKYGV4ZWN1dGVfdGltZWxvY2tlZGAgY2FuIGJlIGNhbGxlZC4gIFRoaXMgZ3VhcmRzIGFnYWluc3QgZmxhc2gtbG9hbgpvciBydXNoZWQgZ292ZXJuYW5jZSBhdHRhY2tzLgAAAAAAAAARRXhlY3V0aW9uVGltZWxvY2sAAAAAAAACAAAAAAAAAAtwcm9wb3NhbF9pZAAAAAAGAAAAAAAAAAl1bmxvY2tfYXQAAAAAAAAG", "AAAAAAAAACJDdXJyZW50IHZvdGluZyBwb3dlciBvZiBgYWNjb3VudGAuAAAAAAAJZ2V0X3ZvdGVzAAAAAAAAAQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAs=", "AAAAAAAAAAAAAAAKZ2V0X2NvbmZpZwAAAAAAAAAAAAEAAAfQAAAAEEdvdmVybmFuY2VDb25maWc=", "AAAAAAAAAFBPbmUtdGltZSBjb25zdHJ1Y3Rvcjogc2V0cyB0aGUgZXh0ZXJuYWwgYWRtaW4gYW5kIGRlZmF1bHQgZ292ZXJuYW5jZSBwYXJhbWV0ZXJzLgAAAAppbml0aWFsaXplAAAAAAABAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAA", "AAAAAAAAACJDaGVjayBpZiBhbiBhZGRyZXNzIGlzIGEgZ3VhcmRpYW4uAAAAAAALaXNfZ3VhcmRpYW4AAAAAAQAAAAAAAAAEYWRkcgAAABMAAAABAAAAAQ==", "AAAAAAAAAFxBY2NlcHQgYSBub21pbmF0aW9uIChzdGVwIDIgb2YgMikuIE11c3QgYmUgc2lnbmVkIGJ5IHRoZSBub21pbmVlLgpFbWl0cyBgKGFkbWluLCBhY2NlcHRlZClgLgAAAAxhY2NlcHRfYWRtaW4AAAABAAAAAAAAAAluZXdfYWRtaW4AAAAAAAATAAAAAA==", "AAAAAAAAAFhBZGQgYSBndWFyZGlhbiBhZGRyZXNzIHRoYXQgY2FuIHZldG8gcXVldWVkIHByb3Bvc2Fscy4KT25seSB0aGUgYWRtaW4gY2FuIGFkZCBndWFyZGlhbnMuAAAADGFkZF9ndWFyZGlhbgAAAAIAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAIZ3VhcmRpYW4AAAATAAAAAA==", "AAAAAAAAAAAAAAAMZ2V0X3Byb3Bvc2FsAAAAAQAAAAAAAAALcHJvcG9zYWxfaWQAAAAABgAAAAEAAAfQAAAACFByb3Bvc2Fs", "AAAAAAAAADZSZXRyaWV2ZSB0aGUgZXhlY3V0aW9uIHRpbWVsb2NrIGZvciBhIHF1ZXVlZCBwcm9wb3NhbC4AAAAAAAxnZXRfdGltZWxvY2sAAAABAAAAAAAAAAtwcm9wb3NhbF9pZAAAAAAGAAAAAQAAB9AAAAARRXhlY3V0aW9uVGltZWxvY2sAAAA=", "AAAAAAAAAIFMb2NrIGBhbW91bnRgIGdvdmVybmFuY2UgdG9rZW5zIGluIHRoaXMgY29udHJhY3QgdG8gZ2FpbiB2b3RpbmcgcG93ZXIuClBvd2VyIGNvdW50cyBvbmx5IGZvciBwcm9wb3NhbHMgY3JlYXRlZCBpbiBhIGxhdGVyIGxlZGdlci4AAAAAAAANZGVwb3NpdF92b3RlcwAAAAAAAAIAAAAAAAAAB2FjY291bnQAAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAQAAAAs=", "AAAAAAAAAEpOb21pbmF0ZSBhIG5ldyBhZG1pbiAoc3RlcCAxIG9mIDIpLiBBZG1pbi1vbmx5LiBFbWl0cyBgKGFkbWluLCBwcm9wb3NlZClgLgAAAAAADXByb3Bvc2VfYWRtaW4AAAAAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAACW5ld19hZG1pbgAAAAAAABMAAAAA", "AAAAAAAAAGlWZXRvIGEgcXVldWVkIHByb3Bvc2FsLiBPbmx5IGd1YXJkaWFucyBjYW4gdmV0by4KUmVtb3ZlcyB0aGUgdGltZWxvY2sgYW5kIG1hcmtzIHRoZSBwcm9wb3NhbCBhcyByZWplY3RlZC4AAAAAAAANdmV0b19wcm9wb3NhbAAAAAAAAAIAAAAAAAAACGd1YXJkaWFuAAAAEwAAAAAAAAALcHJvcG9zYWxfaWQAAAAABgAAAAA=", "AAAAAAAAAXFDYXN0IGEgdG9rZW4td2VpZ2h0ZWQgdm90ZSBvbiBhIHByb3Bvc2FsLgoKVGhlIHZvdGUgd2VpZ2h0IGlzIHRoZSB2b3RlcidzIGNoZWNrcG9pbnRlZCB2b3RpbmcgcG93ZXIgYXQgdGhlCnByb3Bvc2FsJ3Mgc25hcHNob3QgbGVkZ2VyIChJc3N1ZSAjMTU2NSkg4oCUIHRva2VucyBkZXBvc2l0ZWQgb3IKdHJhbnNmZXJyZWQgaW4gYWZ0ZXIgdGhlIHByb3Bvc2FsIHdhcyBjcmVhdGVkIGNhcnJ5IG5vIHdlaWdodCBvbiBpdC4KUHJldmlvdXNseSB0aGUgY2FsbGVyIHN1cHBsaWVkIHRoZSB3ZWlnaHQgZGlyZWN0bHksIHdoaWNoIGxldCBhbnlvbmUKY2xhaW0gYXJiaXRyYXJ5IHBvd2VyIG9yIHZvdGUgd2l0aCBicmllZmx5IGJvcnJvd2VkIHRva2Vucy4AAAAAAAANdm90ZV93ZWlnaHRlZAAAAAAAAAMAAAAAAAAABXZvdGVyAAAAAAAAEwAAAAAAAAALcHJvcG9zYWxfaWQAAAAABgAAAAAAAAAIdm90ZV95ZXMAAAABAAAAAQAAAAE=", "AAAAAAAAAEdXaXRoZHJhdyB0aGUgcGVuZGluZyB1cGdyYWRlLiBBZG1pbi1vbmx5LiBFbWl0cyBgKHVwZ3JhZGUsIGNhbmNlbGxlZClgLgAAAAAOY2FuY2VsX3VwZ3JhZGUAAAAAAAEAAAAAAAAABWFkbWluAAAAAAAAEwAAAAA=", "AAAAAAAAADRWb3RpbmcgcG93ZXIgb2YgYGFjY291bnRgIGFzIG9mIHRoZSBlbmQgb2YgYGxlZGdlcmAuAAAADmdldF9wYXN0X3ZvdGVzAAAAAAACAAAAAAAAAAdhY2NvdW50AAAAABMAAAAAAAAABmxlZGdlcgAAAAAABAAAAAEAAAAL", "AAAAAAAAAEVSZXRyaWV2ZSB0aGUgd2VpZ2h0ZWQgdm90ZSByZWNvcmQgZm9yIGEgc3BlY2lmaWMgdm90ZXIgb24gYSBwcm9wb3NhbC4AAAAAAAAOZ2V0X3Rva2VuX3ZvdGUAAAAAAAIAAAAAAAAAC3Byb3Bvc2FsX2lkAAAAAAYAAAAAAAAABXZvdGVyAAAAAAAAEwAAAAEAAAfQAAAACVRva2VuVm90ZQAAAA==", "AAAAAAAAAMRVbmxvY2sgYGFtb3VudGAgZ292ZXJuYW5jZSB0b2tlbnMuIFZvdGVzIGFscmVhZHkgY2FzdCBhcmUgdW5hZmZlY3RlZAoodGhleSB1c2VkIHRoZSBzbmFwc2hvdCksIGFuZCB0aGUgd2l0aGRyYXduIHRva2VucyBjYW4ndCBiZSByZS11c2VkIG9uCmFueSBwcm9wb3NhbCB3aG9zZSBzbmFwc2hvdCBwcmVkYXRlcyBhIGxhdGVyIHJlLWRlcG9zaXQuAAAADndpdGhkcmF3X3ZvdGVzAAAAAAACAAAAAAAAAAdhY2NvdW50AAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAEAAAAL", "AAAAAAAAAAAAAAAPY3JlYXRlX3Byb3Bvc2FsAAAAAAQAAAAAAAAACHByb3Bvc2VyAAAAEwAAAAAAAAAFdGl0bGUAAAAAAAAQAAAAAAAAAAtkZXNjcmlwdGlvbgAAAAAQAAAAAAAAAA12b3RpbmdfcGVyaW9kAAAAAAAABgAAAAEAAAAG", "AAAAAAAAAGJBcHBseSB0aGUgcGVuZGluZyB1cGdyYWRlIG9uY2UgaXRzIHRpbWVsb2NrIGhhcyBlbGFwc2VkLiBBZG1pbi1vbmx5LgpFbWl0cyBgKGNvbnRyYWN0LCB1cGdyYWRlZClgLgAAAAAAD2V4ZWN1dGVfdXBncmFkZQAAAAABAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAA", "AAAAAAAAAJZQcm9wb3NlIGEgV0FTTSB1cGdyYWRlLiBBZG1pbi1vbmx5LiBSZXR1cm5zIHRoZSBsZWRnZXIgdGltZXN0YW1wIGFmdGVyCndoaWNoIGBleGVjdXRlX3VwZ3JhZGVgIG1heSBiZSBjYWxsZWQgKG5vdyArIDQ4aCkuIEVtaXRzCmAodXBncmFkZSwgcHJvcG9zZWQpYC4AAAAAAA9wcm9wb3NlX3VwZ3JhZGUAAAAAAgAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAA1uZXdfd2FzbV9oYXNoAAAAAAAD7gAAACAAAAABAAAABg==", "AAAAAAAAALNRdWV1ZSBhbiBhcHByb3ZlZCBwcm9wb3NhbCBmb3IgdGltZWxvY2tlZCBleGVjdXRpb24uCgpgdGltZWxvY2tfZGVsYXlgIGlzIGluIHNlY29uZHMuICBUaGUgcHJvcG9zYWwgbXVzdCBhbHJlYWR5IGJlIGluCiJhcHByb3ZlZCIgc3RhdHVzIChpLmUuIGBleGVjdXRlX3Byb3Bvc2FsYCBoYXMgYmVlbiBjYWxsZWQpLgAAAAAPcXVldWVfZXhlY3V0aW9uAAAAAAIAAAAAAAAAC3Byb3Bvc2FsX2lkAAAAAAYAAAAAAAAADnRpbWVsb2NrX2RlbGF5AAAAAAAGAAAAAA==", "AAAAAAAAADdSZW1vdmUgYSBndWFyZGlhbi4gT25seSB0aGUgYWRtaW4gY2FuIHJlbW92ZSBndWFyZGlhbnMuAAAAAA9yZW1vdmVfZ3VhcmRpYW4AAAAAAgAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAhndWFyZGlhbgAAABMAAAAA", "AAAAAAAAAAAAAAAQZXhlY3V0ZV9wcm9wb3NhbAAAAAEAAAAAAAAAC3Byb3Bvc2FsX2lkAAAAAAYAAAABAAAAAQ==", "AAAAAAAAACRUaGUgZ292ZXJuYW5jZSB0b2tlbiwgaWYgY29uZmlndXJlZC4AAAAQZ2V0X3ZvdGluZ190b2tlbgAAAAAAAAABAAAD6AAAABM=", "AAAAAAAAAAAAAAAQc2V0X3BsYXRmb3JtX2ZlZQAAAAIAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAALZmVlX3BlcmNlbnQAAAAABAAAAAEAAAAB", "AAAAAAAAAI9TZXQgdGhlIGdvdmVybmFuY2UgdG9rZW4gd2hvc2UgZGVwb3NpdHMgY29uZmVyIHZvdGluZyBwb3dlci4gQWRtaW4tb25seQphbmQgc2V0LW9uY2U6IHN3YXBwaW5nIHRoZSB0b2tlbiB3b3VsZCBpbnZhbGlkYXRlIGV4aXN0aW5nIGNoZWNrcG9pbnRzLgAAAAAQc2V0X3ZvdGluZ190b2tlbgAAAAIAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAA==", "AAAAAAAAAY5GaW5hbGl6ZSBhIHByb3Bvc2FsIGFmdGVyIGl0cyB2b3RpbmcgZGVhZGxpbmUsIGVuZm9yY2luZyBxdW9ydW0uCgpSZXF1aXJlcyBgKHllc192b3RlcyArIG5vX3ZvdGVzKSAqIDEwMCAvIHRvdGFsID49IHF1b3J1bV9wZXJjZW50YCwgd2hlcmUKYHRvdGFsYCBhbmQgYHF1b3J1bV9wZXJjZW50YCB3ZXJlIGZyb3plbiB3aGVuIHRoZSBwcm9wb3NhbCB3YXMgY3JlYXRlZAooSXNzdWUgIzE3MTApLiBQYW5pY3MgaWYgcXVvcnVtIGlzIG5vdCBtZXQsIHZvdGluZyBpcyBzdGlsbCBvcGVuLCBubwpwb3dlciB3YXMgZGVwb3NpdGVkIGF0IHRoZSBzbmFwc2hvdCwgb3IgdGhlIHByb3Bvc2FsIHByZWRhdGVzICMxNzEwIGFuZApoYXMgbm90IGJlZW4gdGhyb3VnaCBgbWlncmF0ZV9wcm9wb3NhbF9xdW9ydW1gLgAAAAAAEWZpbmFsaXplX3Byb3Bvc2FsAAAAAAAAAQAAAAAAAAALcHJvcG9zYWxfaWQAAAAABgAAAAEAAAAB", "AAAAAAAAADFUaGUgbm9taW5hdGVkLWJ1dC1ub3QteWV0LWFjY2VwdGVkIGFkbWluLCBpZiBhbnkuAAAAAAAAEWdldF9wZW5kaW5nX2FkbWluAAAAAAAAAAAAAAEAAAPoAAAAEw==", "AAAAAAAAAAAAAAARc2V0X2JvdW50eV9saW1pdHMAAAAAAAADAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAACm1pbl9idWRnZXQAAAAAAAsAAAAAAAAACm1heF9idWRnZXQAAAAAAAsAAAABAAAAAQ==", "AAAAAAAAALZFeGVjdXRlIGEgdGltZWxvY2tlZCBwcm9wb3NhbCBhZnRlciBpdHMgZGVsYXkgaGFzIGVsYXBzZWQuCgpJZiB0aGUgcHJvcG9zYWwgY2FycmllcyBhIGBQcm9wb3NhbFBhcmFtYCAoc3RvcmVkIHZpYQpgY3JlYXRlX3BhcmFtX3Byb3Bvc2FsYCksIHRoZSBnb3Zlcm5hbmNlIGNvbmZpZyBpcyB1cGRhdGVkIG9uLWNoYWluLgAAAAAAEmV4ZWN1dGVfdGltZWxvY2tlZAAAAAAAAQAAAAAAAAALcHJvcG9zYWxfaWQAAAAABgAAAAEAAAAB", "AAAAAAAAADJHZXQgdGhlIGN1cnJlbnQgcXVvcnVtIHRocmVzaG9sZC4gRGVmYXVsdHMgdG8gMTAlLgAAAAAAEmdldF9xdW9ydW1fcGVyY2VudAAAAAAAAAAAAAEAAAAG", "AAAAAAAAADpTZXQgdGhlIHF1b3J1bSB0aHJlc2hvbGQgKDDigJMxMDApLiBPbmx5IGFkbWluIGNhbiB1cGRhdGUuAAAAAAASc2V0X3F1b3J1bV9wZXJjZW50AAAAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAADnF1b3J1bV9wZXJjZW50AAAAAAAGAAAAAA==", "AAAAAAAAAQ1LZWVwZXIgZW50cnlwb2ludCAoSXNzdWUgIzE3MjApOiBleHRlbmQgdGhlIGNvbnRyYWN0IGluc3RhbmNlLCB0aGUKc2hhcmVkIGNvbmZpZy9jb3VudGVyIGVudHJpZXMgYW5kIGV2ZXJ5IHBlci1wcm9wb3NhbCBlbnRyeSBmb3IKYHByb3Bvc2FsX2lkc2AgdGhhdCBzdGlsbCBleGlzdHMuIFBlcm1pc3Npb25sZXNzOyBpdCBvbmx5IHBheXMgcmVudC4KUmV0dXJucyBob3cgbWFueSBwcm9wb3NhbHMgd2VyZSBmb3VuZC4gQXQgbW9zdCBgTUFYX0tFRVBFUl9CQVRDSGAgaWRzLgAAAAAAABNleHRlbmRfcHJvcG9zYWxfdHRsAAAAAAEAAAAAAAAADHByb3Bvc2FsX2lkcwAAA+oAAAAGAAAAAQAAAAQ=", "AAAAAAAAADdUaGUgdXBncmFkZSBjdXJyZW50bHkgd2FpdGluZyBvdXQgaXRzIHRpbWVsb2NrLCBpZiBhbnkuAAAAABNnZXRfcGVuZGluZ191cGdyYWRlAAAAAAAAAAABAAAD6AAAB9AAAAAOUGVuZGluZ1VwZ3JhZGUAAA==", "AAAAAAAAAGdRdW9ydW0gaW5wdXRzIGZyb3plbiBmb3IgYHByb3Bvc2FsX2lkYCBhdCBjcmVhdGlvbjoKYCh0b3RhbF92b3RpbmdfcG93ZXJfYXRfc25hcHNob3QsIHF1b3J1bV9wZXJjZW50KWAuAAAAABNnZXRfcHJvcG9zYWxfcXVvcnVtAAAAAAEAAAAAAAAAC3Byb3Bvc2FsX2lkAAAAAAYAAAABAAAD7QAAAAIAAAALAAAABg==", "AAAAAAAAAExXaXRoZHJhdyBhIHBlbmRpbmcgYWRtaW4gbm9taW5hdGlvbi4gQWRtaW4tb25seS4gRW1pdHMgYChhZG1pbiwgY2FuY2VsbGVkKWAuAAAAFWNhbmNlbF9hZG1pbl90cmFuc2ZlcgAAAAAAAAEAAAAAAAAABWFkbWluAAAAAAAAEwAAAAA=", "AAAAAAAAAORDcmVhdGUgYSBwcm9wb3NhbCB0aGF0IGNhcnJpZXMgYW4gb24tY2hhaW4gcGFyYW1ldGVyIGNoYW5nZS4KCkNvbWJpbmVzIGBjcmVhdGVfcHJvcG9zYWxgIHdpdGggYXR0YWNoaW5nIGEgYFByb3Bvc2FsUGFyYW1gIHNvIHRoYXQKb24gYXBwcm92YWwgKyB0aW1lbG9jayBleHBpcnkgdGhlIGNvbmZpZyB1cGRhdGVzIGF0b21pY2FsbHkgd2l0aG91dCBhbnkKZnVydGhlciBhZG1pbiB0cmFuc2FjdGlvbi4AAAAVY3JlYXRlX3BhcmFtX3Byb3Bvc2FsAAAAAAAABQAAAAAAAAAIcHJvcG9zZXIAAAATAAAAAAAAAAV0aXRsZQAAAAAAABAAAAAAAAAAC2Rlc2NyaXB0aW9uAAAAABAAAAAAAAAADXZvdGluZ19wZXJpb2QAAAAAAAAGAAAAAAAAAAVwYXJhbQAAAAAAB9AAAAANUHJvcG9zYWxQYXJhbQAAAAAAAAEAAAAG", "AAAAAAAAADtMZWRnZXIgYXQgd2hpY2ggdm90aW5nIHBvd2VyIGlzIG1lYXN1cmVkIGZvciBgcHJvcG9zYWxfaWRgLgAAAAAVZ2V0X3Byb3Bvc2FsX3NuYXBzaG90AAAAAAAAAQAAAAAAAAALcHJvcG9zYWxfaWQAAAAABgAAAAEAAAAE", "AAAAAAAAADhHZXQgdGhlIGN1cnJlbnQgdGltZWxvY2sgZHVyYXRpb24uIERlZmF1bHRzIHRvIDQ4IGhvdXJzLgAAABVnZXRfdGltZWxvY2tfZHVyYXRpb24AAAAAAAAAAAAAAQAAAAY=", "AAAAAAAAAEZTZXQgdGhlIGRlZmF1bHQgdGltZWxvY2sgZHVyYXRpb24gKGluIHNlY29uZHMpLiBPbmx5IGFkbWluIGNhbiBjaGFuZ2UuAAAAAAAVc2V0X3RpbWVsb2NrX2R1cmF0aW9uAAAAAAAAAgAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAA1kdXJhdGlvbl9zZWNzAAAAAAAABgAAAAA=", "AAAAAAAAAO1DdXJyZW50IHRvdGFsIGRlcG9zaXRlZCB2b3RpbmcgcG93ZXIgKElzc3VlICMxNzEwKS4KClRoaXMgdXNlZCB0byBiZSBhbiBhZG1pbi1zZXQgbnVtYmVyLiBJdCBpcyBub3cgdGhlIHN1bSBvZiBhbGwKYGRlcG9zaXRfdm90ZXNgIG1pbnVzIGB3aXRoZHJhd192b3Rlc2AsIGNoZWNrcG9pbnRlZCBwZXIgbGVkZ2VyLgpTYXR1cmF0ZXMgYXQgYHU2NDo6TUFYYCB0byBrZWVwIHRoZSBleGlzdGluZyByZXR1cm4gdHlwZS4AAAAAAAAWZ2V0X3RvdGFsX3ZvdGluZ19wb3dlcgAAAAAAAAAAAAEAAAAG", "AAAAAAAAAa1PbmUtdGltZSBtaWdyYXRpb24gZm9yIHByb3Bvc2FscyBjcmVhdGVkIGJlZm9yZSBJc3N1ZSAjMTcxMC4KClBlcm1pc3Npb25sZXNzOiBpdCBvbmx5IHJlY29yZHMgdmFsdWVzIHRoYXQgYXJlIGFscmVhZHkgZGV0ZXJtaW5lZC4KVGhlIHRvdGFsIGlzIHJlYWQgYXQgdGhlIHByb3Bvc2FsJ3Mgdm90aW5nIHNuYXBzaG90IGxlZGdlciB3aGVuIGl0IGhhcwpvbmUgKElzc3VlICMxNTY1KSwgb3RoZXJ3aXNlIGF0IHRoZSBsZWRnZXIgYmVmb3JlIHRoaXMgY2FsbDsgdGhlIHF1b3J1bQpwZXJjZW50YWdlIGlzIHRoZSBvbmUgaW4gZm9yY2Ugbm93LiBJdCBhbHNvIGRlbGV0ZXMgdGhlIG9ic29sZXRlCmFkbWluLXNldCBgdG90YWxfdnBgIGVudHJ5LiBGYWlscyBpZiB0aGUgcHJvcG9zYWwgaXMgYWxyZWFkeSBtaWdyYXRlZApvciBubyBsb25nZXIgcGVuZGluZy4AAAAAAAAXbWlncmF0ZV9wcm9wb3NhbF9xdW9ydW0AAAAAAQAAAAAAAAALcHJvcG9zYWxfaWQAAAAABgAAAAEAAAPtAAAAAgAAAAsAAAAG", "AAAAAAAAAEFRdWV1ZSBhbiBhcHByb3ZlZCBwcm9wb3NhbCB1c2luZyB0aGUgY29uZmlndXJlZCBkZWZhdWx0IHRpbWVsb2NrLgAAAAAAABdxdWV1ZV9leGVjdXRpb25fZGVmYXVsdAAAAAABAAAAAAAAAAtwcm9wb3NhbF9pZAAAAAAGAAAAAA==", "AAAAAAAAADdUb3RhbCBkZXBvc2l0ZWQgdm90aW5nIHBvd2VyIGFzIG9mIHRoZSBlbmQgb2YgYGxlZGdlcmAuAAAAABtnZXRfcGFzdF90b3RhbF92b3RpbmdfcG93ZXIAAAAAAQAAAAAAAAAGbGVkZ2VyAAAAAAAEAAAAAQAAAAs=", "AAAABAAAAK1FcnJvcnMgcmFpc2VkIGJ5IHRoZSBzaGFyZWQgdXBncmFkZS9hZG1pbiBoZWxwZXJzLgoKQ29kZXMgc3RhcnQgYXQgOTAwIHNvIHRoZXkgZG9uJ3Qgb3ZlcmxhcCBhbnkgY29udHJhY3QncyBvd24gZXJyb3IgZW51bTsKdGhleSBzdXJmYWNlIG9uLWNoYWluIGFzIGBFcnJvcihDb250cmFjdCwgIzl4eClgLgAAAAAAAAAAAAAMVXBncmFkZUVycm9yAAAABgAAAB9DYWxsZXIgaXMgbm90IHRoZSBzdG9yZWQgYWRtaW4uAAAAAAxVbmF1dGhvcml6ZWQAAAOEAAAAQWBleGVjdXRlX3VwZ3JhZGVgIC8gYGNhbmNlbF91cGdyYWRlYCBjYWxsZWQgd2l0aCBub3RoaW5nIHBlbmRpbmcuAAAAAAAAEE5vUGVuZGluZ1VwZ3JhZGUAAAOFAAAAMGBleGVjdXRlX3VwZ3JhZGVgIGNhbGxlZCBiZWZvcmUgYGV4ZWN1dGFibGVfYXRgLgAAABJUaW1lbG9ja05vdEVsYXBzZWQAAAAAA4YAAABFYGFjY2VwdF9hZG1pbmAgLyBgY2FuY2VsX2FkbWluX3RyYW5zZmVyYCBjYWxsZWQgd2l0aCBub3RoaW5nIHBlbmRpbmcuAAAAAAAADk5vUGVuZGluZ0FkbWluAAAAAAOHAAAAO2BhY2NlcHRfYWRtaW5gIHNpZ25lZCBieSBhbiBhZGRyZXNzIG90aGVyIHRoYW4gdGhlIG5vbWluZWUuAAAAAA9Ob3RQZW5kaW5nQWRtaW4AAAADiAAAACxgcHJvcG9zZV9hZG1pbmAgbm9taW5hdGVkIHRoZSBjdXJyZW50IGFkbWluLgAAAAlTYW1lQWRtaW4AAAAAAAOJ", "AAAAAQAAADFBIHByb3Bvc2VkIGNvZGUgdXBncmFkZSB3YWl0aW5nIG91dCBpdHMgdGltZWxvY2suAAAAAAAAAAAAAA5QZW5kaW5nVXBncmFkZQAAAAAAAwAAAAAAAAANZXhlY3V0YWJsZV9hdAAAAAAAAAYAAAAAAAAAC3Byb3Bvc2VkX2F0AAAAAAYAAAAAAAAACXdhc21faGFzaAAAAAAAA+4AAAAg"]),
      options
    );
  }

   static deploy<T = Client>(options: MethodOptions & Omit<ContractClientOptions, 'contractId'> & { wasmHash: Buffer | string; salt?: Buffer | Uint8Array; format?: "hex" | "base64"; address?: string; }): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options);
  }
  public readonly fromJSON = {
    vote : this.txFromJSON<boolean>,  get_votes : this.txFromJSON<bigint>,  get_config : this.txFromJSON<GovernanceConfig>,  initialize : this.txFromJSON<void>,  is_guardian : this.txFromJSON<boolean>,  accept_admin : this.txFromJSON<void>,  add_guardian : this.txFromJSON<void>,  get_proposal : this.txFromJSON<Proposal>,  get_timelock : this.txFromJSON<ExecutionTimelock>,  deposit_votes : this.txFromJSON<bigint>,  propose_admin : this.txFromJSON<void>,  veto_proposal : this.txFromJSON<void>,  vote_weighted : this.txFromJSON<boolean>,  cancel_upgrade : this.txFromJSON<void>,  get_past_votes : this.txFromJSON<bigint>,  get_token_vote : this.txFromJSON<TokenVote>,  withdraw_votes : this.txFromJSON<bigint>,  create_proposal : this.txFromJSON<bigint>,  execute_upgrade : this.txFromJSON<void>,  propose_upgrade : this.txFromJSON<bigint>,  queue_execution : this.txFromJSON<void>,  remove_guardian : this.txFromJSON<void>,  execute_proposal : this.txFromJSON<boolean>,  get_voting_token : this.txFromJSON<string | null>,  set_platform_fee : this.txFromJSON<boolean>,  set_voting_token : this.txFromJSON<void>,  finalize_proposal : this.txFromJSON<boolean>,  get_pending_admin : this.txFromJSON<string | null>,  set_bounty_limits : this.txFromJSON<boolean>,  execute_timelocked : this.txFromJSON<boolean>,  get_quorum_percent : this.txFromJSON<bigint>,  set_quorum_percent : this.txFromJSON<void>,  extend_proposal_ttl : this.txFromJSON<number>,  get_pending_upgrade : this.txFromJSON<PendingUpgrade | null>,  get_proposal_quorum : this.txFromJSON<[bigint, bigint]>,  cancel_admin_transfer : this.txFromJSON<void>,  create_param_proposal : this.txFromJSON<bigint>,  get_proposal_snapshot : this.txFromJSON<number>,  get_timelock_duration : this.txFromJSON<bigint>,  set_timelock_duration : this.txFromJSON<void>,  get_total_voting_power : this.txFromJSON<bigint>,  migrate_proposal_quorum : this.txFromJSON<[bigint, bigint]>,  queue_execution_default : this.txFromJSON<void>,  get_past_total_voting_power : this.txFromJSON<bigint>
  };

}