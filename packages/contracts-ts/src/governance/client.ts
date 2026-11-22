import {GovernanceConfig, Proposal, ExecutionTimelock, TokenVote, ProposalParam} from './types';
import {Spec, AssembledTransaction, Client as ContractClient, ClientOptions as ContractClientOptions, MethodOptions} from '@stellar/stellar-sdk/contract';
import {Address} from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';

export interface Client {
  vote({ voter, proposal_id, vote_yes }: { voter: string | Address; proposal_id: bigint; vote_yes: boolean }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  /**
   * Upgrade the contract WASM. Only the governance admin multisig may call this.
   * Emits an `upgraded` event with the new wasm hash.
   */
  upgrade({ admin, new_wasm_hash }: { admin: string | Address; new_wasm_hash: Buffer }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
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
   * Veto a queued proposal. Only guardians can veto.
   * Removes the timelock and marks the proposal as rejected.
   */
  veto_proposal({ guardian, proposal_id }: { guardian: string | Address; proposal_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Cast a token-weighted vote on a proposal.
   *
   * `token_weight` is the caller's token balance used as vote weight.  The
   * contract accumulates weighted tallies (`yes_votes` / `no_votes`) so that
   * large token holders have proportionally more influence.
   */
  vote_weighted({ voter, proposal_id, vote_yes, token_weight }: { voter: string | Address; proposal_id: bigint; vote_yes: boolean; token_weight: bigint }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  /**
   * Retrieve the weighted vote record for a specific voter on a proposal.
   */
  get_token_vote({ proposal_id, voter }: { proposal_id: bigint; voter: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<TokenVote>>;
  create_proposal({ proposer, title, description, voting_period }: { proposer: string | Address; title: string; description: string; voting_period: bigint }, options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
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
  set_platform_fee({ admin, fee_percent }: { admin: string | Address; fee_percent: number }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  /**
   * Finalize a proposal after its voting deadline, enforcing quorum.
   *
   * Requires `(yes_votes + no_votes) * 100 / total_supply >= quorum_percent`.
   * Panics if quorum is not met, voting is still open, or total supply is 0.
   */
  finalize_proposal({ proposal_id }: { proposal_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
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
   * Create a proposal that carries an on-chain parameter change.
   *
   * Combines `create_proposal` with attaching a `ProposalParam` so that
   * on approval + timelock expiry the config updates atomically without any
   * further admin transaction.
   */
  create_param_proposal({ proposer, title, description, voting_period, param }: { proposer: string | Address; title: string; description: string; voting_period: bigint; param: ProposalParam }, options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  /**
   * Get the current timelock duration. Defaults to 48 hours.
   */
  get_timelock_duration(options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  /**
   * Set the default timelock duration (in seconds). Only admin can change.
   */
  set_timelock_duration({ admin, duration_secs }: { admin: string | Address; duration_secs: bigint }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Get total voting power. Returns 0 if not yet configured.
   */
  get_total_voting_power(options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  /**
   * Set total voting power (governance token supply). Admin only.
   */
  set_total_voting_power({ admin, total }: { admin: string | Address; total: bigint }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Queue an approved proposal using the configured default timelock.
   */
  queue_execution_default({ proposal_id }: { proposal_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
}

export class Client extends ContractClient {
  constructor(public readonly options: ContractClientOptions) {
    super(
      new Spec(["AAAAAQAAAAhQcm9wb3NhbAAAAAAAAAAIUHJvcG9zYWwAAAAJAAAAAAAAAApjcmVhdGVkX2F0AAAAAAAGAAAAAAAAAAtkZXNjcmlwdGlvbgAAAAAQAAAAAAAAAAJpZAAAAAAABgAAAAAAAAAIbm9fdm90ZXMAAAAGAAAAAAAAAAhwcm9wb3NlcgAAABMAAAAAAAAABnN0YXR1cwAAAAAAEAAAAAAAAAAFdGl0bGUAAAAAAAAQAAAAAAAAAA92b3RpbmdfZGVhZGxpbmUAAAAABgAAAAAAAAAJeWVzX3ZvdGVzAAAAAAAABg==", "AAAAAQAAAO1XZWlnaHRlZCB2b3RlIGNhc3QgYnkgYSB0b2tlbiBob2xkZXIuCgpgd2VpZ2h0YCBpcyB0aGUgdm90ZXIncyB0b2tlbiBiYWxhbmNlIGF0IHZvdGUgdGltZSwgZXhwcmVzc2VkIGluIHRoZQp0b2tlbidzIHNtYWxsZXN0IGRlbm9taW5hdGlvbi4gIENhbGxlcnMgc3VwcGx5IHRoaXMgdmFsdWU7IGEgcHJvZHVjdGlvbgpkZXBsb3ltZW50IHdvdWxkIHJlYWQgaXQgZnJvbSBhbiBvbi1jaGFpbiB0b2tlbiBjb250cmFjdC4AAAAAAAAAAAAACVRva2VuVm90ZQAAAAAAAAQAAAAAAAAAC3Byb3Bvc2FsX2lkAAAAAAYAAAAAAAAACHZvdGVfeWVzAAAAAQAAAAAAAAAFdm90ZXIAAAAAAAATAAAAAAAAAAZ3ZWlnaHQAAAAAAAY=", "AAAAAQAAARFPcHRpb25hbCBvbi1jaGFpbiBwYXJhbWV0ZXIgY2hhbmdlIGF0dGFjaGVkIHRvIGEgcHJvcG9zYWwuCgpXaGVuIGEgcHJvcG9zYWwgY2FycmllcyBhIGBQcm9wb3NhbFBhcmFtYCwgYGV4ZWN1dGVfdGltZWxvY2tlZGAgYXBwbGllcwp0aGUgY2hhbmdlIGRpcmVjdGx5IHRvIHRoZSBnb3Zlcm5hbmNlIGNvbmZpZywgY3JlYXRpbmcgYSBmdWxseSBvbi1jaGFpbgpwYXJhbWV0ZXItdXBkYXRlIGZsb3cgd2l0aG91dCByZXF1aXJpbmcgYSBzZXBhcmF0ZSBhZG1pbiB0cmFuc2FjdGlvbi4AAAAAAAAAAAAADVByb3Bvc2FsUGFyYW0AAAAAAAADAAAANE5ldyBwbGF0Zm9ybSBmZWUgaW4gYmFzaXMgcG9pbnRzIChOb25lID0gbm8gY2hhbmdlKS4AAAAOdGFyZ2V0X2ZlZV9icHMAAAAAA+gAAAAEAAAALU5ldyBtYXhpbXVtIGJvdW50eSBidWRnZXQgKE5vbmUgPSBubyBjaGFuZ2UpLgAAAAAAABF0YXJnZXRfbWF4X2J1ZGdldAAAAAAAA+gAAAALAAAALU5ldyBtaW5pbXVtIGJvdW50eSBidWRnZXQgKE5vbmUgPSBubyBjaGFuZ2UpLgAAAAAAABF0YXJnZXRfbWluX2J1ZGdldAAAAAAAA+gAAAAL", "AAAAAQAAABhHb3Zlcm5hbmNlIENvbmZpZ3VyYXRpb24AAAAAAAAAEEdvdmVybmFuY2VDb25maWcAAAAGAAAAAAAAAA1hZG1pbl9hZGRyZXNzAAAAAAAAEwAAAAAAAAAZZGlzcHV0ZV9yZXNvbHV0aW9uX3BlcmlvZAAAAAAAAAYAAAAAAAAADGxhc3RfdXBkYXRlZAAAAAYAAAAAAAAAEW1heF9ib3VudHlfYnVkZ2V0AAAAAAAACwAAAAAAAAARbWluX2JvdW50eV9idWRnZXQAAAAAAAALAAAAAAAAABRwbGF0Zm9ybV9mZWVfcGVyY2VudAAAAAQ=", "AAAAAQAAANRFeGVjdXRpb24gdGltZWxvY2sgZm9yIGFuIGFwcHJvdmVkIHByb3Bvc2FsLgoKQW4gYXBwcm92ZWQgcHJvcG9zYWwgbXVzdCB3YWl0IGB1bmxvY2tfYXRgIChsZWRnZXIgdGltZXN0YW1wKSBiZWZvcmUKYGV4ZWN1dGVfdGltZWxvY2tlZGAgY2FuIGJlIGNhbGxlZC4gIFRoaXMgZ3VhcmRzIGFnYWluc3QgZmxhc2gtbG9hbgpvciBydXNoZWQgZ292ZXJuYW5jZSBhdHRhY2tzLgAAAAAAAAARRXhlY3V0aW9uVGltZWxvY2sAAAAAAAACAAAAAAAAAAtwcm9wb3NhbF9pZAAAAAAGAAAAAAAAAAl1bmxvY2tfYXQAAAAAAAAG", "AAAAAAAAAAAAAAAEdm90ZQAAAAMAAAAAAAAABXZvdGVyAAAAAAAAEwAAAAAAAAALcHJvcG9zYWxfaWQAAAAABgAAAAAAAAAIdm90ZV95ZXMAAAABAAAAAQAAAAE=", "AAAAAAAAAH5VcGdyYWRlIHRoZSBjb250cmFjdCBXQVNNLiBPbmx5IHRoZSBnb3Zlcm5hbmNlIGFkbWluIG11bHRpc2lnIG1heSBjYWxsIHRoaXMuCkVtaXRzIGFuIGB1cGdyYWRlZGAgZXZlbnQgd2l0aCB0aGUgbmV3IHdhc20gaGFzaC4AAAAAAAd1cGdyYWRlAAAAAAIAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAANbmV3X3dhc21faGFzaAAAAAAAA+4AAAAgAAAAAA==", "AAAAAAAAAAAAAAAKZ2V0X2NvbmZpZwAAAAAAAAAAAAEAAAfQAAAAEEdvdmVybmFuY2VDb25maWc=", "AAAAAAAAAFBPbmUtdGltZSBjb25zdHJ1Y3Rvcjogc2V0cyB0aGUgZXh0ZXJuYWwgYWRtaW4gYW5kIGRlZmF1bHQgZ292ZXJuYW5jZSBwYXJhbWV0ZXJzLgAAAAppbml0aWFsaXplAAAAAAABAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAA", "AAAAAAAAACJDaGVjayBpZiBhbiBhZGRyZXNzIGlzIGEgZ3VhcmRpYW4uAAAAAAALaXNfZ3VhcmRpYW4AAAAAAQAAAAAAAAAEYWRkcgAAABMAAAABAAAAAQ==", "AAAAAAAAAFhBZGQgYSBndWFyZGlhbiBhZGRyZXNzIHRoYXQgY2FuIHZldG8gcXVldWVkIHByb3Bvc2Fscy4KT25seSB0aGUgYWRtaW4gY2FuIGFkZCBndWFyZGlhbnMuAAAADGFkZF9ndWFyZGlhbgAAAAIAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAIZ3VhcmRpYW4AAAATAAAAAA==", "AAAAAAAAAAAAAAAMZ2V0X3Byb3Bvc2FsAAAAAQAAAAAAAAALcHJvcG9zYWxfaWQAAAAABgAAAAEAAAfQAAAACFByb3Bvc2Fs", "AAAAAAAAADZSZXRyaWV2ZSB0aGUgZXhlY3V0aW9uIHRpbWVsb2NrIGZvciBhIHF1ZXVlZCBwcm9wb3NhbC4AAAAAAAxnZXRfdGltZWxvY2sAAAABAAAAAAAAAAtwcm9wb3NhbF9pZAAAAAAGAAAAAQAAB9AAAAARRXhlY3V0aW9uVGltZWxvY2sAAAA=", "AAAAAAAAAGlWZXRvIGEgcXVldWVkIHByb3Bvc2FsLiBPbmx5IGd1YXJkaWFucyBjYW4gdmV0by4KUmVtb3ZlcyB0aGUgdGltZWxvY2sgYW5kIG1hcmtzIHRoZSBwcm9wb3NhbCBhcyByZWplY3RlZC4AAAAAAAANdmV0b19wcm9wb3NhbAAAAAAAAAIAAAAAAAAACGd1YXJkaWFuAAAAEwAAAAAAAAALcHJvcG9zYWxfaWQAAAAABgAAAAA=", "AAAAAAAAAPJDYXN0IGEgdG9rZW4td2VpZ2h0ZWQgdm90ZSBvbiBhIHByb3Bvc2FsLgoKYHRva2VuX3dlaWdodGAgaXMgdGhlIGNhbGxlcidzIHRva2VuIGJhbGFuY2UgdXNlZCBhcyB2b3RlIHdlaWdodC4gIFRoZQpjb250cmFjdCBhY2N1bXVsYXRlcyB3ZWlnaHRlZCB0YWxsaWVzIChgeWVzX3ZvdGVzYCAvIGBub192b3Rlc2ApIHNvIHRoYXQKbGFyZ2UgdG9rZW4gaG9sZGVycyBoYXZlIHByb3BvcnRpb25hbGx5IG1vcmUgaW5mbHVlbmNlLgAAAAAADXZvdGVfd2VpZ2h0ZWQAAAAAAAAEAAAAAAAAAAV2b3RlcgAAAAAAABMAAAAAAAAAC3Byb3Bvc2FsX2lkAAAAAAYAAAAAAAAACHZvdGVfeWVzAAAAAQAAAAAAAAAMdG9rZW5fd2VpZ2h0AAAABgAAAAEAAAAB", "AAAAAAAAAEVSZXRyaWV2ZSB0aGUgd2VpZ2h0ZWQgdm90ZSByZWNvcmQgZm9yIGEgc3BlY2lmaWMgdm90ZXIgb24gYSBwcm9wb3NhbC4AAAAAAAAOZ2V0X3Rva2VuX3ZvdGUAAAAAAAIAAAAAAAAAC3Byb3Bvc2FsX2lkAAAAAAYAAAAAAAAABXZvdGVyAAAAAAAAEwAAAAEAAAfQAAAACVRva2VuVm90ZQAAAA==", "AAAAAAAAAAAAAAAPY3JlYXRlX3Byb3Bvc2FsAAAAAAQAAAAAAAAACHByb3Bvc2VyAAAAEwAAAAAAAAAFdGl0bGUAAAAAAAAQAAAAAAAAAAtkZXNjcmlwdGlvbgAAAAAQAAAAAAAAAA12b3RpbmdfcGVyaW9kAAAAAAAABgAAAAEAAAAG", "AAAAAAAAALNRdWV1ZSBhbiBhcHByb3ZlZCBwcm9wb3NhbCBmb3IgdGltZWxvY2tlZCBleGVjdXRpb24uCgpgdGltZWxvY2tfZGVsYXlgIGlzIGluIHNlY29uZHMuICBUaGUgcHJvcG9zYWwgbXVzdCBhbHJlYWR5IGJlIGluCiJhcHByb3ZlZCIgc3RhdHVzIChpLmUuIGBleGVjdXRlX3Byb3Bvc2FsYCBoYXMgYmVlbiBjYWxsZWQpLgAAAAAPcXVldWVfZXhlY3V0aW9uAAAAAAIAAAAAAAAAC3Byb3Bvc2FsX2lkAAAAAAYAAAAAAAAADnRpbWVsb2NrX2RlbGF5AAAAAAAGAAAAAA==", "AAAAAAAAADdSZW1vdmUgYSBndWFyZGlhbi4gT25seSB0aGUgYWRtaW4gY2FuIHJlbW92ZSBndWFyZGlhbnMuAAAAAA9yZW1vdmVfZ3VhcmRpYW4AAAAAAgAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAhndWFyZGlhbgAAABMAAAAA", "AAAAAAAAAAAAAAAQZXhlY3V0ZV9wcm9wb3NhbAAAAAEAAAAAAAAAC3Byb3Bvc2FsX2lkAAAAAAYAAAABAAAAAQ==", "AAAAAAAAAAAAAAAQc2V0X3BsYXRmb3JtX2ZlZQAAAAIAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAALZmVlX3BlcmNlbnQAAAAABAAAAAEAAAAB", "AAAAAAAAANRGaW5hbGl6ZSBhIHByb3Bvc2FsIGFmdGVyIGl0cyB2b3RpbmcgZGVhZGxpbmUsIGVuZm9yY2luZyBxdW9ydW0uCgpSZXF1aXJlcyBgKHllc192b3RlcyArIG5vX3ZvdGVzKSAqIDEwMCAvIHRvdGFsX3N1cHBseSA+PSBxdW9ydW1fcGVyY2VudGAuClBhbmljcyBpZiBxdW9ydW0gaXMgbm90IG1ldCwgdm90aW5nIGlzIHN0aWxsIG9wZW4sIG9yIHRvdGFsIHN1cHBseSBpcyAwLgAAABFmaW5hbGl6ZV9wcm9wb3NhbAAAAAAAAAEAAAAAAAAAC3Byb3Bvc2FsX2lkAAAAAAYAAAABAAAAAQ==", "AAAAAAAAAAAAAAARc2V0X2JvdW50eV9saW1pdHMAAAAAAAADAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAACm1pbl9idWRnZXQAAAAAAAsAAAAAAAAACm1heF9idWRnZXQAAAAAAAsAAAABAAAAAQ==", "AAAAAAAAALZFeGVjdXRlIGEgdGltZWxvY2tlZCBwcm9wb3NhbCBhZnRlciBpdHMgZGVsYXkgaGFzIGVsYXBzZWQuCgpJZiB0aGUgcHJvcG9zYWwgY2FycmllcyBhIGBQcm9wb3NhbFBhcmFtYCAoc3RvcmVkIHZpYQpgY3JlYXRlX3BhcmFtX3Byb3Bvc2FsYCksIHRoZSBnb3Zlcm5hbmNlIGNvbmZpZyBpcyB1cGRhdGVkIG9uLWNoYWluLgAAAAAAEmV4ZWN1dGVfdGltZWxvY2tlZAAAAAAAAQAAAAAAAAALcHJvcG9zYWxfaWQAAAAABgAAAAEAAAAB", "AAAAAAAAADJHZXQgdGhlIGN1cnJlbnQgcXVvcnVtIHRocmVzaG9sZC4gRGVmYXVsdHMgdG8gMTAlLgAAAAAAEmdldF9xdW9ydW1fcGVyY2VudAAAAAAAAAAAAAEAAAAG", "AAAAAAAAADpTZXQgdGhlIHF1b3J1bSB0aHJlc2hvbGQgKDDigJMxMDApLiBPbmx5IGFkbWluIGNhbiB1cGRhdGUuAAAAAAASc2V0X3F1b3J1bV9wZXJjZW50AAAAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAADnF1b3J1bV9wZXJjZW50AAAAAAAGAAAAAA==", "AAAAAAAAAORDcmVhdGUgYSBwcm9wb3NhbCB0aGF0IGNhcnJpZXMgYW4gb24tY2hhaW4gcGFyYW1ldGVyIGNoYW5nZS4KCkNvbWJpbmVzIGBjcmVhdGVfcHJvcG9zYWxgIHdpdGggYXR0YWNoaW5nIGEgYFByb3Bvc2FsUGFyYW1gIHNvIHRoYXQKb24gYXBwcm92YWwgKyB0aW1lbG9jayBleHBpcnkgdGhlIGNvbmZpZyB1cGRhdGVzIGF0b21pY2FsbHkgd2l0aG91dCBhbnkKZnVydGhlciBhZG1pbiB0cmFuc2FjdGlvbi4AAAAVY3JlYXRlX3BhcmFtX3Byb3Bvc2FsAAAAAAAABQAAAAAAAAAIcHJvcG9zZXIAAAATAAAAAAAAAAV0aXRsZQAAAAAAABAAAAAAAAAAC2Rlc2NyaXB0aW9uAAAAABAAAAAAAAAADXZvdGluZ19wZXJpb2QAAAAAAAAGAAAAAAAAAAVwYXJhbQAAAAAAB9AAAAANUHJvcG9zYWxQYXJhbQAAAAAAAAEAAAAG", "AAAAAAAAADhHZXQgdGhlIGN1cnJlbnQgdGltZWxvY2sgZHVyYXRpb24uIERlZmF1bHRzIHRvIDQ4IGhvdXJzLgAAABVnZXRfdGltZWxvY2tfZHVyYXRpb24AAAAAAAAAAAAAAQAAAAY=", "AAAAAAAAAEZTZXQgdGhlIGRlZmF1bHQgdGltZWxvY2sgZHVyYXRpb24gKGluIHNlY29uZHMpLiBPbmx5IGFkbWluIGNhbiBjaGFuZ2UuAAAAAAAVc2V0X3RpbWVsb2NrX2R1cmF0aW9uAAAAAAAAAgAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAA1kdXJhdGlvbl9zZWNzAAAAAAAABgAAAAA=", "AAAAAAAAADhHZXQgdG90YWwgdm90aW5nIHBvd2VyLiBSZXR1cm5zIDAgaWYgbm90IHlldCBjb25maWd1cmVkLgAAABZnZXRfdG90YWxfdm90aW5nX3Bvd2VyAAAAAAAAAAAAAQAAAAY=", "AAAAAAAAAD1TZXQgdG90YWwgdm90aW5nIHBvd2VyIChnb3Zlcm5hbmNlIHRva2VuIHN1cHBseSkuIEFkbWluIG9ubHkuAAAAAAAAFnNldF90b3RhbF92b3RpbmdfcG93ZXIAAAAAAAIAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAFdG90YWwAAAAAAAAGAAAAAA==", "AAAAAAAAAEFRdWV1ZSBhbiBhcHByb3ZlZCBwcm9wb3NhbCB1c2luZyB0aGUgY29uZmlndXJlZCBkZWZhdWx0IHRpbWVsb2NrLgAAAAAAABdxdWV1ZV9leGVjdXRpb25fZGVmYXVsdAAAAAABAAAAAAAAAAtwcm9wb3NhbF9pZAAAAAAGAAAAAA=="]),
      options
    );
  }

   static deploy<T = Client>(options: MethodOptions & Omit<ContractClientOptions, 'contractId'> & { wasmHash: Buffer | string; salt?: Buffer | Uint8Array; format?: "hex" | "base64"; address?: string; }): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options);
  }
  public readonly fromJSON = {
    vote : this.txFromJSON<boolean>,  upgrade : this.txFromJSON<void>,  get_config : this.txFromJSON<GovernanceConfig>,  initialize : this.txFromJSON<void>,  is_guardian : this.txFromJSON<boolean>,  add_guardian : this.txFromJSON<void>,  get_proposal : this.txFromJSON<Proposal>,  get_timelock : this.txFromJSON<ExecutionTimelock>,  veto_proposal : this.txFromJSON<void>,  vote_weighted : this.txFromJSON<boolean>,  get_token_vote : this.txFromJSON<TokenVote>,  create_proposal : this.txFromJSON<bigint>,  queue_execution : this.txFromJSON<void>,  remove_guardian : this.txFromJSON<void>,  execute_proposal : this.txFromJSON<boolean>,  set_platform_fee : this.txFromJSON<boolean>,  finalize_proposal : this.txFromJSON<boolean>,  set_bounty_limits : this.txFromJSON<boolean>,  execute_timelocked : this.txFromJSON<boolean>,  get_quorum_percent : this.txFromJSON<bigint>,  set_quorum_percent : this.txFromJSON<void>,  create_param_proposal : this.txFromJSON<bigint>,  get_timelock_duration : this.txFromJSON<bigint>,  set_timelock_duration : this.txFromJSON<void>,  get_total_voting_power : this.txFromJSON<bigint>,  set_total_voting_power : this.txFromJSON<void>,  queue_execution_default : this.txFromJSON<void>
  };

}