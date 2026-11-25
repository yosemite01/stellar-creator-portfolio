import {ReleaseCondition, EscrowError, EscrowAccount, Arbiter, Evidence, DisputeCase, Milestone, EscrowStatus, DisputeOutcome, PendingUpgrade, ArbitrationConfig, PendingFeeConfig, FeeConfig} from './types';
import {Result, Spec, AssembledTransaction, Client as ContractClient, ClientOptions as ContractClientOptions, MethodOptions} from '@stellar/stellar-sdk/contract';
import {Address} from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';

export interface Client {
  /**
   * Deposit funds into escrow
   *
   * Charges whatever fee is effective at execution time. Wallet-facing
   * flows should prefer [`Self::deposit_with_max_fee`], which reverts if the
   * fee rose after the user was quoted (#1724).
   */
  deposit({ bounty_id, payer, payee, amount, token, release_condition }: { bounty_id: bigint; payer: string | Address; payee: string | Address; amount: bigint; token: string | Address; release_condition: ReleaseCondition }, options?: MethodOptions): Promise<AssembledTransaction<Result<bigint, EscrowError>>>;
  /**
   * Get the current platform admin address.
   */
  get_admin(options?: MethodOptions): Promise<AssembledTransaction<Result<string, EscrowError>>>;
  get_escrow({ escrow_id }: { escrow_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<EscrowAccount, EscrowError>>>;
  /**
   * Update the platform fee configuration. Only the governance multisig
   * (platform admin) may call this.
   *
   * #1724: a change that lowers (or keeps) both the rate and the cap applies
   * immediately and emits `(escrow, fee_upd)`. A change that raises either
   * is scheduled for `now + FEE_CHANGE_DELAY_SECS` and announced with
   * `(escrow, fee_prop)`; it becomes effective automatically once the delay
   * elapses (and can be persisted with `apply_fee_update`). A new call
   * replaces any pending change.
   */
  update_fee({ admin, new_bps, new_cap }: { admin: string | Address; new_bps: bigint; new_cap: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, EscrowError>>>;
  /**
   * Add `token` to the deposit allowlist. Admin-only.
   */
  allow_token({ admin, token }: { admin: string | Address; token: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, EscrowError>>>;
  /**
   * Bind an Active escrow to a bounty. Only the bounty contract may call;
   * the escrow must have been deposited for `bounty_id` by `creator`, and
   * neither side may already be bound.
   */
  bind_bounty({ bounty_contract, bounty_id, escrow_id, creator }: { bounty_contract: string | Address; bounty_id: bigint; escrow_id: bigint; creator: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<boolean, EscrowError>>>;
  can_release({ escrow_id }: { escrow_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<boolean, EscrowError>>>;
  /**
   * Commit `sha256(payee_bps as u32 big-endian || salt)` (see
   * [`vote_commitment`]). Panel members only, before the commit deadline.
   */
  commit_vote({ arbiter, escrow_id, commitment }: { arbiter: string | Address; escrow_id: bigint; commitment: Buffer }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, EscrowError>>>;
  get_arbiter({ arbiter }: { arbiter: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<Arbiter, EscrowError>>>;
  /**
   * Measured surplus: contract balance of `token` minus liabilities.
   * This is the only source `withdraw_yield` can pay from (#1706).
   */
  get_surplus({ token }: { token: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  pause_yield({ admin }: { admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, EscrowError>>>;
  /**
   * Reveal a committed vote between the commit and reveal deadlines.
   */
  reveal_vote({ arbiter, escrow_id, payee_bps, salt }: { arbiter: string | Address; escrow_id: bigint; payee_bps: number; salt: Buffer }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, EscrowError>>>;
  /**
   * Accept a nomination (step 2 of 2). Must be signed by the nominee.
   * Emits `(admin, accepted)`.
   */
  accept_admin({ new_admin }: { new_admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Accrue the yield *entitlement* for an active escrow.
   *
   * `accrued` is a cap on what `withdraw_yield` may take for this escrow;
   * it is never paid out of principal. Actual payouts are bounded by the
   * measured surplus (`get_surplus`), see `withdraw_yield` (#1706).
   *
   * Path-independent (#1707): the sub-unit remainder of
   * `principal * rate_bps * elapsed` is carried in `YieldRemainder`, so N
   * calls over Δt accrue exactly what one call over NΔt does. Calling it
   * every ledger therefore cannot zero out yield, and the entrypoint can
   * safely stay permissionless.
   *
   * Event: `(yield, accrued)` → `(escrow_id, new_yield, accrued)`.
   */
  accrue_yield({ escrow_id }: { escrow_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, EscrowError>>>;
  get_evidence({ escrow_id }: { escrow_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Array<Evidence>>>;
  /**
   * Add a milestone to an active escrow.
   *
   * The running total may not exceed the escrow amount. Milestones cannot
   * be released until the plan sums to the escrow amount exactly; when the
   * last milestone brings the total to the escrow amount the deposit fee is
   * allocated across milestones and `(escrow, ms_plan)` is emitted (#1712).
   */
  add_milestone({ authorizer, escrow_id, index, description, amount }: { authorizer: string | Address; escrow_id: bigint; index: number; description: string; amount: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, EscrowError>>>;
  /**
   * Appeal a round-0 ruling within the appeal window. Payer or payee only.
   * Draws a fresh, larger panel that excludes the first panel.
   */
  appeal_ruling({ party, escrow_id }: { party: string | Address; escrow_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<DisputeCase, EscrowError>>>;
  /**
   * Return the platform fee that would be charged for a given gross amount.
   * Mirrors the `platform_fee` free function for on-chain queries.
   */
  calculate_fee({ gross_amount }: { gross_amount: bigint }, options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  get_milestone({ escrow_id, index }: { escrow_id: bigint; index: number }, options?: MethodOptions): Promise<AssembledTransaction<Result<Milestone, EscrowError>>>;
  /**
   * Nominate a new admin (step 1 of 2). Admin-only. Emits `(admin, proposed)`.
   */
  propose_admin({ admin, new_admin }: { admin: string | Address; new_admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Refund escrow to payer. Only payer may call.
   */
  refund_escrow({ authorizer, escrow_id }: { authorizer: string | Address; escrow_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<boolean, EscrowError>>>;
  /**
   * Release funds to payee. Authorizer must be payer or payee.
   */
  release_funds({ authorizer, escrow_id }: { authorizer: string | Address; escrow_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<boolean, EscrowError>>>;
  /**
   * Close the current round after its reveal deadline. Anyone may call.
   * Round 0 produces an appealable ruling; an appeal round's ruling is
   * final and paid out immediately.
   */
  tally_dispute({ escrow_id }: { escrow_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<DisputeCase, EscrowError>>>;
  unpause_yield({ admin }: { admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, EscrowError>>>;
  /**
   * Withdraw the pending upgrade. Admin-only. Emits `(upgrade, cancelled)`.
   */
  cancel_upgrade({ admin }: { admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Remove `token` from the deposit allowlist. Existing escrows in that
   * token can still be released or refunded. Admin-only.
   */
  disallow_token({ admin, token }: { admin: string | Address; token: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, EscrowError>>>;
  /**
   * Mark escrow as disputed. Either party may raise a dispute.
   */
  dispute_escrow({ authorizer, escrow_id }: { authorizer: string | Address; escrow_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<boolean, EscrowError>>>;
  /**
   * Pay out an unappealed round-0 ruling once the appeal window closes.
   * Anyone may call.
   */
  execute_ruling({ escrow_id }: { escrow_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<boolean, EscrowError>>>;
  /**
   * Withdraw yield for an escrow to the platform admin.
   *
   * Behind the `YieldWithdrawEnabled` flag (default off). Pays
   * `min(accrued entitlement, measured surplus)`: yield is the contract's
   * balance above tracked principal (e.g. returns credited by an external
   * strategy), never a computed number, so this can never touch another
   * escrow's principal. The solvency check
   * `balance - amount >= total_liabilities` is enforced on the transfer.
   *
   * Event: `(yield, withdrawn)` → `(escrow_id, amount, admin)`.
   */
  withdraw_yield({ admin, escrow_id }: { admin: string | Address; escrow_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<bigint, EscrowError>>>;
  /**
   * Set yield configuration.  Only the platform admin may call this.
   */
  configure_yield({ admin, rate_bps, max_yield_ratio, min_liquidity_bps }: { admin: string | Address; rate_bps: number; max_yield_ratio: number; min_liquidity_bps: number }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, EscrowError>>>;
  /**
   * Apply the pending upgrade once its timelock has elapsed. Admin-only.
   * Emits `(contract, upgraded)`.
   */
  execute_upgrade({ admin }: { admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  is_yield_paused(options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  /**
   * Propose a WASM upgrade. Admin-only. Returns the ledger timestamp after
   * which `execute_upgrade` may be called (now + 48h). Emits
   * `(upgrade, proposed)`.
   */
  propose_upgrade({ admin, new_wasm_hash }: { admin: string | Address; new_wasm_hash: Buffer }, options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  /**
   * Anchor an evidence hash on-chain. `hash` is the sha256 returned by
   * `POST /api/disputes/:id/evidence` (`evidenceHash`). Payer or payee only.
   */
  submit_evidence({ party, escrow_id, hash }: { party: string | Address; escrow_id: bigint; hash: Buffer }, options?: MethodOptions): Promise<AssembledTransaction<Result<number, EscrowError>>>;
  /**
   * Re-split the milestone plan before any milestone is released.
   *
   * `indices[i]` gets `amounts[i]`. Every listed index must exist; the plan
   * total after the amendment must equal the escrow amount exactly, and the
   * fee is re-allocated. Payer-only. Emits `(escrow, ms_amend)` (#1712).
   */
  amend_milestones({ authorizer, escrow_id, indices, amounts }: { authorizer: string | Address; escrow_id: bigint; indices: Array<number>; amounts: Array<bigint> }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, EscrowError>>>;
  /**
   * Persist a pending fee increase whose timelock has elapsed. Anyone may
   * call this; it only writes what `get_fee_config` already treats as
   * effective. Emits `(escrow, fee_upd)`.
   */
  apply_fee_update(options?: MethodOptions): Promise<AssembledTransaction<Result<null, EscrowError>>>;
  /**
   * Escrow id bound to `bounty_id`, or 0.
   */
  get_bound_escrow({ bounty_id }: { bounty_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  get_dispute_case({ escrow_id }: { escrow_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<DisputeCase, EscrowError>>>;
  is_token_allowed({ token }: { token: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  /**
   * Stake `amount` of the stake token to join (or top up in) the arbiter pool.
   */
  register_arbiter({ arbiter, amount }: { arbiter: string | Address; amount: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<Arbiter, EscrowError>>>;
  /**
   * Withdraw a scheduled fee increase before it takes effect. Admin-only.
   * Emits `(escrow, fee_cncl)`.
   */
  cancel_fee_update({ admin }: { admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, EscrowError>>>;
  /**
   * Keeper entrypoint (#1720): extend the instance, shared config and every
   * entry belonging to `escrow_ids` that still exists. Permissionless; it
   * only pays rent. Returns how many escrows were found.
   */
  extend_escrow_ttl({ escrow_ids }: { escrow_ids: Array<bigint> }, options?: MethodOptions): Promise<AssembledTransaction<Result<number, EscrowError>>>;
  /**
   * Read the currently accrued yield for an escrow without modifying state.
   */
  get_accrued_yield({ escrow_id }: { escrow_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  /**
   * Status of an escrow (cheap view used by the bounty contract's
   * joint-state invariant check).
   */
  get_escrow_status({ escrow_id }: { escrow_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<EscrowStatus, EscrowError>>>;
  /**
   * The nominated-but-not-yet-accepted admin, if any.
   */
  get_pending_admin(options?: MethodOptions): Promise<AssembledTransaction<string | null>>;
  /**
   * Draw a panel for a disputed escrow that has none yet (e.g. the pool was
   * too small when the dispute was raised). Anyone may call.
   */
  open_dispute_case({ escrow_id }: { escrow_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<DisputeCase, EscrowError>>>;
  /**
   * Refund a bound escrow to the payer. Called by the bounty contract from
   * `cancel_bounty` / `check_and_expire_bounty`.
   */
  refund_for_bounty({ bounty_contract, bounty_id }: { bounty_contract: string | Address; bounty_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<boolean, EscrowError>>>;
  /**
   * Release a single milestone payment to payee. Authorizer must be payer.
   *
   * Requires the milestone plan to sum to the escrow amount
   * (`MilestoneSumMismatch` otherwise). Emits `(escrow, ms_rel)` with
   * `(escrow_id, index, payee, gross, fee, net)` where `net` is the amount
   * transferred and `fee` the milestone's share of the deposit fee.
   */
  release_milestone({ authorizer, escrow_id, index }: { authorizer: string | Address; escrow_id: bigint; index: number }, options?: MethodOptions): Promise<AssembledTransaction<Result<boolean, EscrowError>>>;
  /**
   * Update the maximum acceptable slippage (bps) for yield-protocol
   * deposits. Only the platform admin may call this. Defaults to
   * `DEFAULT_MAX_SLIPPAGE_BPS` (1 %) until explicitly configured.
   */
  configure_slippage({ admin, max_slippage_bps }: { admin: string | Address; max_slippage_bps: number }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, EscrowError>>>;
  /**
   * Pay a bound escrow out to `payee` (the selected freelancer). Called by
   * the bounty contract from `complete_bounty`.
   */
  release_for_bounty({ bounty_contract, bounty_id, payee }: { bounty_contract: string | Address; bounty_id: bigint; payee: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<boolean, EscrowError>>>;
  /**
   * Set the oracle contract address. Only governance multisig may call this.
   */
  set_oracle_address({ admin, oracle }: { admin: string | Address; oracle: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, EscrowError>>>;
  /**
   * Submit a Stellar transaction for an escrow operation.
   *
   * This is the on-chain entry point called by the backend Stellar SDK
   * after building and signing a transaction envelope. It validates the
   * operation type and delegates to the appropriate escrow function.
   *
   * `operation`: one of "release", "refund", "dispute". "deposit" and any
   * other value fail with `UnsupportedOperation` (use `deposit()` directly).
   * `escrow_id`: target escrow
   * Returns the escrow_id that was acted upon.
   */
  submit_transaction({ caller, operation, escrow_id }: { caller: string | Address; operation: string; escrow_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<bigint, EscrowError>>>;
  get_bounty_contract(options?: MethodOptions): Promise<AssembledTransaction<string | null>>;
  /**
   * Verified outcome of a resolved dispute, if the escrow was disputed and
   * settled (#1711). `None` for escrows that were never disputed or are
   * still in dispute.
   */
  get_dispute_outcome({ escrow_id }: { escrow_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<DisputeOutcome | null>>;
  /**
   * The upgrade currently waiting out its timelock, if any.
   */
  get_pending_upgrade(options?: MethodOptions): Promise<AssembledTransaction<PendingUpgrade | null>>;
  /**
   * Count principal of escrows created before liability tracking existed
   * (#1706). Admin-only, idempotent; processes ids `from_id..=to_id` and
   * returns how many escrows were newly counted. Run over all existing
   * ids before enabling `withdraw_yield` on an upgraded contract.
   *
   * Event: `(escrow, liab_mig)` → `(from_id, to_id, counted)`.
   */
  migrate_liabilities({ admin, from_id, to_id }: { admin: string | Address; from_id: bigint; to_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<number, EscrowError>>>;
  /**
   * Register the bounty contract trusted to drive bound escrows. Admin-only.
   */
  set_bounty_contract({ admin, bounty_contract }: { admin: string | Address; bounty_contract: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, EscrowError>>>;
  /**
   * Deposit funds into escrow, reverting with `FeeExceedsMax` if the
   * platform fee charged would exceed `max_fee` token units (#1724).
   *
   * Clients obtain `max_fee` from `estimate_fund_escrow_fee` at quote time
   * (optionally plus a tolerance the user accepted) and pass it here, so a
   * fee change between quote and execution can never over-charge the user.
   */
  deposit_with_max_fee({ bounty_id, payer, payee, amount, token, release_condition, max_fee }: { bounty_id: bigint; payer: string | Address; payee: string | Address; amount: bigint; token: string | Address; release_condition: ReleaseCondition; max_fee: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<bigint, EscrowError>>>;
  /**
   * Withdraw a pending admin nomination. Admin-only. Emits `(admin, cancelled)`.
   */
  cancel_admin_transfer({ admin }: { admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * One-time setup of the arbiter stake token and minimum stake. The admin
   * cannot change it later and has no say in any outcome.
   */
  configure_arbitration({ admin, stake_token, min_stake }: { admin: string | Address; stake_token: string | Address; min_stake: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, EscrowError>>>;
  /**
   * Milestone indices of an escrow, in creation order.
   */
  get_milestone_indices({ escrow_id }: { escrow_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Array<number>>>;
  /**
   * Total principal the contract still owes for `token` (#1706).
   */
  get_total_liabilities({ token }: { token: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  /**
   * Refund an expired bounty's escrow to the payer. Called by the bounty
   * contract when expiring. #1714: `bounty_contract` must be the contract
   * registered via `set_bounty_contract` (any contract used to be able to
   * refund any bounty's escrow). Kept for older bounty deployments; new
   * ones call `refund_for_bounty`.
   */
  refund_expired_bounty({ bounty_id, bounty_contract }: { bounty_id: bigint; bounty_contract: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<boolean, EscrowError>>>;
  get_arbitration_config(options?: MethodOptions): Promise<AssembledTransaction<Result<ArbitrationConfig, EscrowError>>>;
  /**
   * Returns milestone progress for an escrow: (released_count, milestone_count, released_amount, total_amount).
   */
  get_milestone_progress({ escrow_id }: { escrow_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<[number, number, bigint, bigint]>>;
  /**
   * The scheduled fee increase still waiting out its timelock, if any.
   */
  get_pending_fee_config(options?: MethodOptions): Promise<AssembledTransaction<PendingFeeConfig | null>>;
  /**
   * Withdraw stake. Not allowed while the arbiter sits on an open panel.
   */
  withdraw_arbiter_stake({ arbiter, amount }: { arbiter: string | Address; amount: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<bigint, EscrowError>>>;
  /**
   * Fallback for a dispute that never got a panel (no or too few arbiters)
   * once its expiry window has elapsed: fixed 50/50 split. Anyone may call.
   *
   * Fails with:
   * - `EscrowNotDisputed` if escrow is not in Disputed state
   * - `CaseAlreadyOpen` if an arbiter panel is handling the dispute
   * - `DisputeNotExpired` if the expiry window has not yet elapsed
   */
  resolve_expired_dispute({ escrow_id }: { escrow_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<boolean, EscrowError>>>;
  /**
   * Quote the platform fee for funding an escrow with `amount`.
   *
   * Uses the fee config effective *now*. Pass the result (plus any
   * tolerance the user accepts) as `max_fee` to `deposit_with_max_fee`: if
   * governance raises the fee before the transaction lands, the deposit
   * reverts instead of over-charging (#1724). Fee increases are also
   * timelocked by `FEE_CHANGE_DELAY_SECS`; see `get_pending_fee_config`.
   */
  estimate_fund_escrow_fee({ amount }: { amount: bigint }, options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  get_active_escrows_count(options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  /**
   * The fee config currently in effect (including a matured increase).
   */
  get_effective_fee_config(options?: MethodOptions): Promise<AssembledTransaction<FeeConfig>>;
  /**
   * Get the latest escrow ID for a specific bounty.
   */
  get_escrow_id_for_bounty({ bounty_id }: { bounty_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  /**
   * Return the oracle staleness threshold in seconds (governance-configurable).
   * Defaults to 3600 (1 hour).
   */
  get_oracle_staleness_secs(options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  is_yield_withdraw_enabled(options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  /**
   * Set the oracle staleness threshold. Only governance multisig may call this.
   */
  set_oracle_staleness_secs({ admin, staleness_secs }: { admin: string | Address; staleness_secs: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, EscrowError>>>;
  /**
   * Enable or disable `withdraw_yield` (#1706). Disabled by default.
   * Admin-only. Event: `(yield, wd_flag)` → `enabled`.
   */
  set_yield_withdraw_enabled({ admin, enabled }: { admin: string | Address; enabled: boolean }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, EscrowError>>>;
}

export class Client extends ContractClient {
  constructor(public readonly options: ContractClientOptions) {
    super(
      new Spec(["AAAAAQAAAAAAAAAAAAAAB0FyYml0ZXIAAAAABAAAAAAAAAAMYWN0aXZlX2Nhc2VzAAAABAAAAAAAAAAHYWRkcmVzcwAAAAATAAAAAAAAAApyZXB1dGF0aW9uAAAAAAAEAAAAAAAAAAVzdGFrZQAAAAAAAAs=", "AAAAAQAAAAAAAAAAAAAACEV2aWRlbmNlAAAAAwAAAAAAAAAEaGFzaAAAA+4AAAAgAAAAAAAAAAxzdWJtaXR0ZWRfYXQAAAAGAAAAAAAAAAlzdWJtaXR0ZXIAAAAAAAAT", "AAAAAwAAAAAAAAAAAAAACUNhc2VQaGFzZQAAAAAAAAMAAAArUGFuZWwgZHJhd247IGNvbW1pdHMgdGhlbiByZXZlYWxzIGFyZSBvcGVuLgAAAAAGVm90aW5nAAAAAAAAAAAAQVJvdW5kLTAgcnVsaW5nIHJlY29yZGVkOyBtYXkgYmUgYXBwZWFsZWQgdW50aWwgYGFwcGVhbF9kZWFkbGluZWAuAAAAAAAACkFwcGVhbGFibGUAAAAAAAEAAAAmUnVsaW5nIGlzIGZpbmFsIGFuZCBoYXMgYmVlbiBwYWlkIG91dC4AAAAAAAVGaW5hbAAAAAAAAAI=", "AAAAAQAAAAAAAAAAAAAAC0Rpc3B1dGVDYXNlAAAAAA0AAAAAAAAAD2FwcGVhbF9kZWFkbGluZQAAAAAGAAAAAAAAAAlhcHBlbGxhbnQAAAAAAAPoAAAAEwAAAAAAAAAPY29tbWl0X2RlYWRsaW5lAAAAAAYAAAAAAAAADGVtcHR5X3JvdW5kcwAAAAQAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAYAAAAAAAAABXBhbmVsAAAAAAAD6gAAABMAAAA1TWVtYmVycyBvZiBlYXJsaWVyIHBhbmVscywgZXhjbHVkZWQgZnJvbSBsYXRlciBkcmF3cy4AAAAAAAALcGFzdF9wYW5lbHMAAAAD6gAAABMAAAAAAAAABXBoYXNlAAAAAAAH0AAAAAlDYXNlUGhhc2UAAAAAAAAAAAAAD3JldmVhbF9kZWFkbGluZQAAAAAGAAAAAAAAAAhyZXZlYWxlZAAAA+oAAAATAAAAIjAgPSBmaXJzdCBwYW5lbCwgMSA9IGFwcGVhbCBwYW5lbC4AAAAAAAVyb3VuZAAAAAAAAAQAAAAAAAAACnJ1bGluZ19icHMAAAAAA+gAAAAEAAAAAAAAAAV2b3RlcwAAAAAAA+oAAAAE", "AAAAAQAAAAAAAAAAAAAAEUFyYml0cmF0aW9uQ29uZmlnAAAAAAAAAgAAAAAAAAAJbWluX3N0YWtlAAAAAAAACwAAAAAAAAALc3Rha2VfdG9rZW4AAAAAEw==", "AAAAAQAAAEFHb3Zlcm5hbmNlLWNvbmZpZ3VyYWJsZSBmZWUgY29uZmlndXJhdGlvbiBzdG9yZWQgb24tY2hhaW4gKCM3MjIpLgAAAAAAAAAAAAAJRmVlQ29uZmlnAAAAAAAAAgAAAAAAAAAHZmVlX2JwcwAAAAALAAAAAAAAAAdmZWVfY2FwAAAAAAs=", "AAAAAQAAAadNaWxlc3RvbmUg4oCUIGEgbmFtZWQgcG9ydGlvbiBvZiB0aGUgdG90YWwgZXNjcm93IGFtb3VudC4KCmBhbW91bnRgIGlzIHRoZSAqKm5ldCoqIHBheW91dCB0byB0aGUgcGF5ZWUgKGVzY3JvdyBhbW91bnRzIGFyZSBhbHJlYWR5IG5ldApvZiB0aGUgcGxhdGZvcm0gZmVlKS4gYGZlZV9zaGFyZWAgaXMgdGhpcyBtaWxlc3RvbmUncyBzaGFyZSBvZiB0aGUgZmVlIHRoYXQKd2FzIGNoYXJnZWQgb25jZSwgb24gdGhlIHRvdGFsLCBhdCBkZXBvc2l0LiBJdCBpcyBhbGxvY2F0ZWQgd2l0aApsYXJnZXN0LXJlbWFpbmRlciByb3VuZGluZyBhcyBzb29uIGFzIHRoZSBtaWxlc3RvbmUgcGxhbiBzdW1zIHRvIHRoZSBlc2Nyb3cKYW1vdW50LCBzbyBgc3VtKGFtb3VudCkgKyBzdW0oZmVlX3NoYXJlKSA9PSBkZXBvc2l0ZWRgIGV4YWN0bHkgKCMxNzEyKS4AAAAAAAAAAAlNaWxlc3RvbmUAAAAAAAAGAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAC2Rlc2NyaXB0aW9uAAAAABEAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAYAAAAAAAAACWZlZV9zaGFyZQAAAAAAAAsAAAAAAAAABWluZGV4AAAAAAAABAAAAAAAAAAIcmVsZWFzZWQAAAAB", "AAAABAAAAQBUeXBlZCBlcnJvcnMgcmV0dXJuZWQgYnkgZXNjcm93IGVudHJ5cG9pbnRzICgjMTU2MikuCgpDb2RlcyBhcmUgcGFydCBvZiB0aGUgY29udHJhY3QncyBwdWJsaWMgaW50ZXJmYWNlOiBjbGllbnRzIGFuZCB0aGUKaW5kZXhlciBtYXAgdGhlbSB0byBtZXNzYWdlcywgc28gbmV2ZXIgcmVudW1iZXIgYW4gZXhpc3RpbmcgdmFyaWFudCDigJQKb25seSBhcHBlbmQgbmV3IG9uZXMuIFNlZSBkb2NzL2NvbnRyYWN0cy5tZCBmb3IgdGhlIGZ1bGwgdGFibGUuAAAAAAAAAAtFc2Nyb3dFcnJvcgAAAAA7AAAAAAAAAA5Fc2Nyb3dOb3RGb3VuZAAAAAAAAQAAAAAAAAALQWRtaW5Ob3RTZXQAAAAAAgAAAAAAAAAPQWRtaW5BbHJlYWR5U2V0AAAAAAMAAAAAAAAADFVuYXV0aG9yaXplZAAAAAQAAAAAAAAAD0VzY3Jvd05vdEFjdGl2ZQAAAAAFAAAAAAAAABZSZWxlYXNlQ29uZGl0aW9uTm90TWV0AAAAAAAGAAAAAAAAABBPcmFjbGVQcmljZVN0YWxlAAAABwAAAAAAAAANSW52YWxpZEFtb3VudAAAAAAAAAgAAAAAAAAAEU5vRXNjcm93Rm9yQm91bnR5AAAAAAAACQAAAAAAAAARRXNjcm93Tm90RGlzcHV0ZWQAAAAAAAAKAAAAAAAAABFEaXNwdXRlTm90RXhwaXJlZAAAAAAAAAsAAAAAAAAAFERpc3B1dGVFeHBpcnlNaXNzaW5nAAAADAAAAAAAAAAKSW52YWxpZEJwcwAAAAAADQAAAAAAAAARTWlsZXN0b25lTm90Rm91bmQAAAAAAAAOAAAAAAAAABZNaWxlc3RvbmVBbHJlYWR5RXhpc3RzAAAAAAAPAAAAAAAAABhNaWxlc3RvbmVBbHJlYWR5UmVsZWFzZWQAAAAQAAAAAAAAABZNaWxlc3RvbmVFeGNlZWRzRXNjcm93AAAAAAARAAAAAAAAABRVbnN1cHBvcnRlZE9wZXJhdGlvbgAAABIAAAAAAAAAC1lpZWxkUGF1c2VkAAAAABMAAAAAAAAAEllpZWxkTm90Q29uZmlndXJlZAAAAAAAFAAAAAAAAAAUWWllbGRBY2NydWFsTm90Rm91bmQAAAAVAAAAAAAAABFOb1lpZWxkVG9XaXRoZHJhdwAAAAAAABYAAAAAAAAAFUluc3VmZmljaWVudExpcXVpZGl0eQAAAAAAABcAAAAAAAAAEEludmFsaWRGZWVDb25maWcAAAAYAAAAAAAAABBJbnZhbGlkU3RhbGVuZXNzAAAAGQAAAEEjMTcxNTogYGRlcG9zaXRgIHdpdGggYSB0b2tlbiB0aGF0IGlzIG5vdCBvbiB0aGUgYWRtaW4gYWxsb3dsaXN0LgAAAAAAAA9Ub2tlbk5vdEFsbG93ZWQAAAAAGgAAAGkjMTcxNTogdGhlIHRva2VuIG1vdmVkIGEgZGlmZmVyZW50IGFtb3VudCB0aGFuIHJlcXVlc3RlZAooZmVlLW9uLXRyYW5zZmVyLCByZWJhc2luZyBvciBuby1vcCBgdHJhbnNmZXJgKS4AAAAAAAAVVG9rZW5UcmFuc2Zlck1pc21hdGNoAAAAAAAAGwAAADkjMTcxNDogYSBib3VudHktZHJpdmVuIGNhbGwgYmVmb3JlIGBzZXRfYm91bnR5X2NvbnRyYWN0YC4AAAAAAAAUQm91bnR5Q29udHJhY3ROb3RTZXQAAAAcAAAANCMxNzE0OiBjYWxsZXIgaXMgbm90IHRoZSByZWdpc3RlcmVkIGJvdW50eSBjb250cmFjdC4AAAARTm90Qm91bnR5Q29udHJhY3QAAAAAAAAdAAAASSMxNzE0OiBlc2Nyb3cgaXMgYm91bmQgdG8gYSBib3VudHk7IGRyaXZlIGl0IHRocm91Z2ggdGhlIGJvdW50eSBjb250cmFjdC4AAAAAAAAPTWFuYWdlZEJ5Qm91bnR5AAAAAB4AAAApIzE3MTQ6IGVzY3JvdyBvciBib3VudHkgaXMgYWxyZWFkeSBib3VuZC4AAAAAAAASRXNjcm93QWxyZWFkeUJvdW5kAAAAAAAfAAAAMSMxNzE0OiBlc2Nyb3cgYmVsb25ncyB0byBhbm90aGVyIGJvdW50eSBvciBwYXllci4AAAAAAAAOQm91bnR5TWlzbWF0Y2gAAAAAACAAAABJVGhlIGVmZmVjdGl2ZSBwbGF0Zm9ybSBmZWUgZXhjZWVkcyB0aGUgY2FsbGVyLXN1cHBsaWVkIGBtYXhfZmVlYCAoIzE3MjQpLgAAAAAAAA1GZWVFeGNlZWRzTWF4AAAAAAAAIQAAADdObyBmZWUgY2hhbmdlIGlzIHNjaGVkdWxlZCAob3IgaXQgYWxyZWFkeSB0b29rIGVmZmVjdCkuAAAAABJOb1BlbmRpbmdGZWVVcGRhdGUAAAAAACIAAABBYGFwcGx5X2ZlZV91cGRhdGVgIGNhbGxlZCBiZWZvcmUgYEZFRV9DSEFOR0VfREVMQVlfU0VDU2AgZWxhcHNlZC4AAAAAAAARRmVlVGltZWxvY2tBY3RpdmUAAAAAAAAjAAAAAAAAABhBcmJpdHJhdGlvbk5vdENvbmZpZ3VyZWQAAAAkAAAAAAAAABxBcmJpdHJhdGlvbkFscmVhZHlDb25maWd1cmVkAAAAJQAAAAAAAAARSW5zdWZmaWNpZW50U3Rha2UAAAAAAAAmAAAAAAAAAA9BcmJpdGVyTm90Rm91bmQAAAAAJwAAAAAAAAALQXJiaXRlckJ1c3kAAAAAKAAAAAAAAAARTm90RW5vdWdoQXJiaXRlcnMAAAAAAAApAAAAAAAAAAxDYXNlTm90Rm91bmQAAAAqAAAAAAAAAApOb3RPblBhbmVsAAAAAAArAAAAAAAAAApXcm9uZ1BoYXNlAAAAAAAsAAAAAAAAABBBbHJlYWR5Q29tbWl0dGVkAAAALQAAAAAAAAASQ29tbWl0bWVudE5vdEZvdW5kAAAAAAAuAAAAAAAAABJDb21taXRtZW50TWlzbWF0Y2gAAAAAAC8AAAAAAAAAD0FscmVhZHlSZXZlYWxlZAAAAAAwAAAAAAAAABBBcHBlYWxOb3RBbGxvd2VkAAAAMQAAAAAAAAAPVG9vTXVjaEV2aWRlbmNlAAAAADIAAAAAAAAAD0Nhc2VBbHJlYWR5T3BlbgAAAAAzAAAAAAAAAA9BcmJpdGVyUG9vbEZ1bGwAAAAANAAAAAAAAAAKVG9vTWFueUlkcwAAAAAANQAAADpNaWxlc3RvbmUgYW1vdW50cyBkbyBub3Qgc3VtIHRvIHRoZSBlc2Nyb3cgYW1vdW50ICgjMTcxMikuAAAAAAAUTWlsZXN0b25lU3VtTWlzbWF0Y2gAAAA2AAAANE1vcmUgdGhhbiBgTUFYX01JTEVTVE9ORVNgIG1pbGVzdG9uZXMgb24gb25lIGVzY3Jvdy4AAAARVG9vTWFueU1pbGVzdG9uZXMAAAAAAAA3AAAAQE1pbGVzdG9uZSBwbGFuIGNhbm5vdCBiZSBhbWVuZGVkIGFmdGVyIGEgbWlsZXN0b25lIHdhcyByZWxlYXNlZC4AAAAUTWlsZXN0b25lQW1lbmRMb2NrZWQAAAA4AAAAb0FuIG91dGZsb3cgd291bGQgbGVhdmUgdGhlIGNvbnRyYWN0IGhvbGRpbmcgbGVzcyB0aGFuIGl0cyB0cmFja2VkCnByaW5jaXBhbCBsaWFiaWxpdGllcyBmb3IgdGhhdCB0b2tlbiAoIzE3MDYpLgAAAAAJSW5zb2x2ZW50AAAAAAAAOQAAAENgd2l0aGRyYXdfeWllbGRgIGlzIGJlaGluZCBhIGZlYXR1cmUgZmxhZyB0aGF0IGlzIGRpc2FibGVkICgjMTcwNikuAAAAABVZaWVsZFdpdGhkcmF3RGlzYWJsZWQAAAAAAAA6AAAAMUFyaXRobWV0aWMgb3ZlcmZsb3cgd2hpbGUgYWNjcnVpbmcgeWllbGQgKCMxNzA3KS4AAAAAAAAIT3ZlcmZsb3cAAAA7", "AAAAAwAAAA1Fc2Nyb3cgU3RhdHVzAAAAAAAAAAAAAAxFc2Nyb3dTdGF0dXMAAAAFAAAAAAAAAAZBY3RpdmUAAAAAAAAAAAAAAAAACFJlbGVhc2VkAAAAAQAAAAAAAAAIUmVmdW5kZWQAAAACAAAAAAAAAAhEaXNwdXRlZAAAAAMAAAAAAAAACENvbXBsZXRlAAAABA==", "AAAAAQAAAA5Fc2Nyb3cgQWNjb3VudAAAAAAAAAAAAA1Fc2Nyb3dBY2NvdW50AAAAAAAACwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAlib3VudHlfaWQAAAAAAAAGAAAAAAAAAApjcmVhdGVkX2F0AAAAAAAGAAAAAAAAAA1mZWVfY29sbGVjdGVkAAAAAAAACwAAAAAAAAACaWQAAAAAAAYAAAAAAAAABXBheWVlAAAAAAAAEwAAAAAAAAAFcGF5ZXIAAAAAAAATAAAAAAAAABFyZWxlYXNlX2NvbmRpdGlvbgAAAAAAB9AAAAAQUmVsZWFzZUNvbmRpdGlvbgAAAAAAAAALcmVsZWFzZWRfYXQAAAAD6AAAAAYAAAAAAAAABnN0YXR1cwAAAAAH0AAAAAxFc2Nyb3dTdGF0dXMAAAAAAAAABXRva2VuAAAAAAAAEw==", "AAAAAQAAAQpGaW5hbCwgb24tY2hhaW4gcmVjb3JkIG9mIGhvdyBhIGRpc3B1dGUgd2FzIHNldHRsZWQgKCMxNzExKS4KCldyaXR0ZW4gYnkgYHJlc29sdmVfZGlzcHV0ZWAgLyBgcmVzb2x2ZV9leHBpcmVkX2Rpc3B1dGVgIGFuZCBleHBvc2VkIHZpYQpgZ2V0X2Rpc3B1dGVfb3V0Y29tZWAgc28gdGhlIGluc3VyYW5jZSBjb250cmFjdCBjYW4gbGluayBhIGNsYWltIHRvIGEKdmVyaWZpZWQgbG9zcyBpbnN0ZWFkIG9mIHRydXN0aW5nIGNsYWltYW50LXN1cHBsaWVkIGV2aWRlbmNlLgAAAAAAAAAAAA5EaXNwdXRlT3V0Y29tZQAAAAAACQAAACpFc2Nyb3dlZCAobmV0KSBhbW91bnQgdGhhdCB3YXMgaW4gZGlzcHV0ZS4AAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAC2Rpc3B1dGVkX2F0AAAAAAYAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAYAAAAAAAAABXBheWVlAAAAAAAAEwAAAAAAAAAMcGF5ZWVfYW1vdW50AAAACwAAAAAAAAAFcGF5ZXIAAAAAAAATAAAAAAAAAAxwYXllcl9hbW91bnQAAAALAAAAAAAAAAtyZXNvbHZlZF9hdAAAAAAGAAAAAAAAAAV0b2tlbgAAAAAAABM=", "AAAAAAAAANJEZXBvc2l0IGZ1bmRzIGludG8gZXNjcm93CgpDaGFyZ2VzIHdoYXRldmVyIGZlZSBpcyBlZmZlY3RpdmUgYXQgZXhlY3V0aW9uIHRpbWUuIFdhbGxldC1mYWNpbmcKZmxvd3Mgc2hvdWxkIHByZWZlciBbYFNlbGY6OmRlcG9zaXRfd2l0aF9tYXhfZmVlYF0sIHdoaWNoIHJldmVydHMgaWYgdGhlCmZlZSByb3NlIGFmdGVyIHRoZSB1c2VyIHdhcyBxdW90ZWQgKCMxNzI0KS4AAAAAAAdkZXBvc2l0AAAAAAYAAAAAAAAACWJvdW50eV9pZAAAAAAAAAYAAAAAAAAABXBheWVyAAAAAAAAEwAAAAAAAAAFcGF5ZWUAAAAAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAARcmVsZWFzZV9jb25kaXRpb24AAAAAAAfQAAAAEFJlbGVhc2VDb25kaXRpb24AAAABAAAD6QAAAAYAAAfQAAAAC0VzY3Jvd0Vycm9yAA==", "AAAAAQAAAEVBIHNjaGVkdWxlZCBmZWUgaW5jcmVhc2Ugd2FpdGluZyBvdXQgYEZFRV9DSEFOR0VfREVMQVlfU0VDU2AgKCMxNzI0KS4AAAAAAAAAAAAAEFBlbmRpbmdGZWVDb25maWcAAAACAAAAAAAAAAZjb25maWcAAAAAB9AAAAAJRmVlQ29uZmlnAAAAAAAAAAAAAAxlZmZlY3RpdmVfYXQAAAAG", "AAAAAgAAABFSZWxlYXNlIENvbmRpdGlvbgAAAAAAAAAAAAAQUmVsZWFzZUNvbmRpdGlvbgAAAAIAAAAAAAAAAAAAAAxPbkNvbXBsZXRpb24AAAABAAAAAAAAAAhUaW1lbG9jawAAAAEAAAAG", "AAAAAAAAACdHZXQgdGhlIGN1cnJlbnQgcGxhdGZvcm0gYWRtaW4gYWRkcmVzcy4AAAAACWdldF9hZG1pbgAAAAAAAAAAAAABAAAD6QAAABMAAAfQAAAAC0VzY3Jvd0Vycm9yAA==", "AAAAAAAAAAAAAAAKZ2V0X2VzY3JvdwAAAAAAAQAAAAAAAAAJZXNjcm93X2lkAAAAAAAABgAAAAEAAAPpAAAH0AAAAA1Fc2Nyb3dBY2NvdW50AAAAAAAH0AAAAAtFc2Nyb3dFcnJvcgA=", "AAAAAAAAAd5VcGRhdGUgdGhlIHBsYXRmb3JtIGZlZSBjb25maWd1cmF0aW9uLiBPbmx5IHRoZSBnb3Zlcm5hbmNlIG11bHRpc2lnCihwbGF0Zm9ybSBhZG1pbikgbWF5IGNhbGwgdGhpcy4KCiMxNzI0OiBhIGNoYW5nZSB0aGF0IGxvd2VycyAob3Iga2VlcHMpIGJvdGggdGhlIHJhdGUgYW5kIHRoZSBjYXAgYXBwbGllcwppbW1lZGlhdGVseSBhbmQgZW1pdHMgYChlc2Nyb3csIGZlZV91cGQpYC4gQSBjaGFuZ2UgdGhhdCByYWlzZXMgZWl0aGVyCmlzIHNjaGVkdWxlZCBmb3IgYG5vdyArIEZFRV9DSEFOR0VfREVMQVlfU0VDU2AgYW5kIGFubm91bmNlZCB3aXRoCmAoZXNjcm93LCBmZWVfcHJvcClgOyBpdCBiZWNvbWVzIGVmZmVjdGl2ZSBhdXRvbWF0aWNhbGx5IG9uY2UgdGhlIGRlbGF5CmVsYXBzZXMgKGFuZCBjYW4gYmUgcGVyc2lzdGVkIHdpdGggYGFwcGx5X2ZlZV91cGRhdGVgKS4gQSBuZXcgY2FsbApyZXBsYWNlcyBhbnkgcGVuZGluZyBjaGFuZ2UuAAAAAAAKdXBkYXRlX2ZlZQAAAAAAAwAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAduZXdfYnBzAAAAAAsAAAAAAAAAB25ld19jYXAAAAAACwAAAAEAAAPpAAAAAgAAB9AAAAALRXNjcm93RXJyb3IA", "AAAAAAAAADFBZGQgYHRva2VuYCB0byB0aGUgZGVwb3NpdCBhbGxvd2xpc3QuIEFkbWluLW9ubHkuAAAAAAAAC2FsbG93X3Rva2VuAAAAAAIAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAQAAA+kAAAACAAAH0AAAAAtFc2Nyb3dFcnJvcgA=", "AAAAAAAAAK5CaW5kIGFuIEFjdGl2ZSBlc2Nyb3cgdG8gYSBib3VudHkuIE9ubHkgdGhlIGJvdW50eSBjb250cmFjdCBtYXkgY2FsbDsKdGhlIGVzY3JvdyBtdXN0IGhhdmUgYmVlbiBkZXBvc2l0ZWQgZm9yIGBib3VudHlfaWRgIGJ5IGBjcmVhdG9yYCwgYW5kCm5laXRoZXIgc2lkZSBtYXkgYWxyZWFkeSBiZSBib3VuZC4AAAAAAAtiaW5kX2JvdW50eQAAAAAEAAAAAAAAAA9ib3VudHlfY29udHJhY3QAAAAAEwAAAAAAAAAJYm91bnR5X2lkAAAAAAAABgAAAAAAAAAJZXNjcm93X2lkAAAAAAAABgAAAAAAAAAHY3JlYXRvcgAAAAATAAAAAQAAA+kAAAABAAAH0AAAAAtFc2Nyb3dFcnJvcgA=", "AAAAAAAAAAAAAAALY2FuX3JlbGVhc2UAAAAAAQAAAAAAAAAJZXNjcm93X2lkAAAAAAAABgAAAAEAAAPpAAAAAQAAB9AAAAALRXNjcm93RXJyb3IA", "AAAAAAAAAH9Db21taXQgYHNoYTI1NihwYXllZV9icHMgYXMgdTMyIGJpZy1lbmRpYW4gfHwgc2FsdClgIChzZWUKW2B2b3RlX2NvbW1pdG1lbnRgXSkuIFBhbmVsIG1lbWJlcnMgb25seSwgYmVmb3JlIHRoZSBjb21taXQgZGVhZGxpbmUuAAAAAAtjb21taXRfdm90ZQAAAAADAAAAAAAAAAdhcmJpdGVyAAAAABMAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAYAAAAAAAAACmNvbW1pdG1lbnQAAAAAA+4AAAAgAAAAAQAAA+kAAAACAAAH0AAAAAtFc2Nyb3dFcnJvcgA=", "AAAAAAAAAAAAAAALZ2V0X2FyYml0ZXIAAAAAAQAAAAAAAAAHYXJiaXRlcgAAAAATAAAAAQAAA+kAAAfQAAAAB0FyYml0ZXIAAAAH0AAAAAtFc2Nyb3dFcnJvcgA=", "AAAAAAAAAH9NZWFzdXJlZCBzdXJwbHVzOiBjb250cmFjdCBiYWxhbmNlIG9mIGB0b2tlbmAgbWludXMgbGlhYmlsaXRpZXMuClRoaXMgaXMgdGhlIG9ubHkgc291cmNlIGB3aXRoZHJhd195aWVsZGAgY2FuIHBheSBmcm9tICgjMTcwNikuAAAAAAtnZXRfc3VycGx1cwAAAAABAAAAAAAAAAV0b2tlbgAAAAAAABMAAAABAAAACw==", "AAAAAAAAAAAAAAALcGF1c2VfeWllbGQAAAAAAQAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAQAAA+kAAAACAAAH0AAAAAtFc2Nyb3dFcnJvcgA=", "AAAAAAAAAEBSZXZlYWwgYSBjb21taXR0ZWQgdm90ZSBiZXR3ZWVuIHRoZSBjb21taXQgYW5kIHJldmVhbCBkZWFkbGluZXMuAAAAC3JldmVhbF92b3RlAAAAAAQAAAAAAAAAB2FyYml0ZXIAAAAAEwAAAAAAAAAJZXNjcm93X2lkAAAAAAAABgAAAAAAAAAJcGF5ZWVfYnBzAAAAAAAABAAAAAAAAAAEc2FsdAAAA+4AAAAgAAAAAQAAA+kAAAACAAAH0AAAAAtFc2Nyb3dFcnJvcgA=", "AAAAAAAAAFxBY2NlcHQgYSBub21pbmF0aW9uIChzdGVwIDIgb2YgMikuIE11c3QgYmUgc2lnbmVkIGJ5IHRoZSBub21pbmVlLgpFbWl0cyBgKGFkbWluLCBhY2NlcHRlZClgLgAAAAxhY2NlcHRfYWRtaW4AAAABAAAAAAAAAAluZXdfYWRtaW4AAAAAAAATAAAAAA==", "AAAAAAAAAmVBY2NydWUgdGhlIHlpZWxkICplbnRpdGxlbWVudCogZm9yIGFuIGFjdGl2ZSBlc2Nyb3cuCgpgYWNjcnVlZGAgaXMgYSBjYXAgb24gd2hhdCBgd2l0aGRyYXdfeWllbGRgIG1heSB0YWtlIGZvciB0aGlzIGVzY3JvdzsKaXQgaXMgbmV2ZXIgcGFpZCBvdXQgb2YgcHJpbmNpcGFsLiBBY3R1YWwgcGF5b3V0cyBhcmUgYm91bmRlZCBieSB0aGUKbWVhc3VyZWQgc3VycGx1cyAoYGdldF9zdXJwbHVzYCksIHNlZSBgd2l0aGRyYXdfeWllbGRgICgjMTcwNikuCgpQYXRoLWluZGVwZW5kZW50ICgjMTcwNyk6IHRoZSBzdWItdW5pdCByZW1haW5kZXIgb2YKYHByaW5jaXBhbCAqIHJhdGVfYnBzICogZWxhcHNlZGAgaXMgY2FycmllZCBpbiBgWWllbGRSZW1haW5kZXJgLCBzbyBOCmNhbGxzIG92ZXIgzpR0IGFjY3J1ZSBleGFjdGx5IHdoYXQgb25lIGNhbGwgb3ZlciBOzpR0IGRvZXMuIENhbGxpbmcgaXQKZXZlcnkgbGVkZ2VyIHRoZXJlZm9yZSBjYW5ub3QgemVybyBvdXQgeWllbGQsIGFuZCB0aGUgZW50cnlwb2ludCBjYW4Kc2FmZWx5IHN0YXkgcGVybWlzc2lvbmxlc3MuCgpFdmVudDogYCh5aWVsZCwgYWNjcnVlZClgIOKGkiBgKGVzY3Jvd19pZCwgbmV3X3lpZWxkLCBhY2NydWVkKWAuAAAAAAAADGFjY3J1ZV95aWVsZAAAAAEAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAYAAAABAAAD6QAAAAIAAAfQAAAAC0VzY3Jvd0Vycm9yAA==", "AAAAAAAAAAAAAAAMZ2V0X2V2aWRlbmNlAAAAAQAAAAAAAAAJZXNjcm93X2lkAAAAAAAABgAAAAEAAAPqAAAH0AAAAAhFdmlkZW5jZQ==", "AAAAAAAAAQRDb25zdHJ1Y3RvciAocHJvdG9jb2wgMjIrKS4gUnVucyBhdG9taWNhbGx5IGluc2lkZSB0aGUgZGVwbG95CnRyYW5zYWN0aW9uLCBzbyB0aGUgcGxhdGZvcm0gYWRtaW4gY2FuIG5ldmVyIGJlIGNsYWltZWQgYnkgd2hvZXZlcgpjYWxscyBmaXJzdCBhZnRlciBkZXBsb3ltZW50IChpc3N1ZSAjMTcwOCkuIExhdGVyIGNoYW5nZXMgZ28gdGhyb3VnaApgcHJvcG9zZV9hZG1pbmAgLyBgYWNjZXB0X2FkbWluYC4gRW1pdHMgYChlc2Nyb3csIGFkbWluX3NldClgLgAAAA1fX2NvbnN0cnVjdG9yAAAAAAAAAQAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAA==", "AAAAAAAAAUJBZGQgYSBtaWxlc3RvbmUgdG8gYW4gYWN0aXZlIGVzY3Jvdy4KClRoZSBydW5uaW5nIHRvdGFsIG1heSBub3QgZXhjZWVkIHRoZSBlc2Nyb3cgYW1vdW50LiBNaWxlc3RvbmVzIGNhbm5vdApiZSByZWxlYXNlZCB1bnRpbCB0aGUgcGxhbiBzdW1zIHRvIHRoZSBlc2Nyb3cgYW1vdW50IGV4YWN0bHk7IHdoZW4gdGhlCmxhc3QgbWlsZXN0b25lIGJyaW5ncyB0aGUgdG90YWwgdG8gdGhlIGVzY3JvdyBhbW91bnQgdGhlIGRlcG9zaXQgZmVlIGlzCmFsbG9jYXRlZCBhY3Jvc3MgbWlsZXN0b25lcyBhbmQgYChlc2Nyb3csIG1zX3BsYW4pYCBpcyBlbWl0dGVkICgjMTcxMikuAAAAAAANYWRkX21pbGVzdG9uZQAAAAAAAAUAAAAAAAAACmF1dGhvcml6ZXIAAAAAABMAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAYAAAAAAAAABWluZGV4AAAAAAAABAAAAAAAAAALZGVzY3JpcHRpb24AAAAAEQAAAAAAAAAGYW1vdW50AAAAAAALAAAAAQAAA+kAAAACAAAH0AAAAAtFc2Nyb3dFcnJvcgA=", "AAAAAAAAAIFBcHBlYWwgYSByb3VuZC0wIHJ1bGluZyB3aXRoaW4gdGhlIGFwcGVhbCB3aW5kb3cuIFBheWVyIG9yIHBheWVlIG9ubHkuCkRyYXdzIGEgZnJlc2gsIGxhcmdlciBwYW5lbCB0aGF0IGV4Y2x1ZGVzIHRoZSBmaXJzdCBwYW5lbC4AAAAAAAANYXBwZWFsX3J1bGluZwAAAAAAAAIAAAAAAAAABXBhcnR5AAAAAAAAEwAAAAAAAAAJZXNjcm93X2lkAAAAAAAABgAAAAEAAAPpAAAH0AAAAAtEaXNwdXRlQ2FzZQAAAAfQAAAAC0VzY3Jvd0Vycm9yAA==", "AAAAAAAAAIZSZXR1cm4gdGhlIHBsYXRmb3JtIGZlZSB0aGF0IHdvdWxkIGJlIGNoYXJnZWQgZm9yIGEgZ2l2ZW4gZ3Jvc3MgYW1vdW50LgpNaXJyb3JzIHRoZSBgcGxhdGZvcm1fZmVlYCBmcmVlIGZ1bmN0aW9uIGZvciBvbi1jaGFpbiBxdWVyaWVzLgAAAAAADWNhbGN1bGF0ZV9mZWUAAAAAAAABAAAAAAAAAAxncm9zc19hbW91bnQAAAALAAAAAQAAAAs=", "AAAAAAAAAAAAAAANZ2V0X21pbGVzdG9uZQAAAAAAAAIAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAYAAAAAAAAABWluZGV4AAAAAAAABAAAAAEAAAPpAAAH0AAAAAlNaWxlc3RvbmUAAAAAAAfQAAAAC0VzY3Jvd0Vycm9yAA==", "AAAAAAAAAEpOb21pbmF0ZSBhIG5ldyBhZG1pbiAoc3RlcCAxIG9mIDIpLiBBZG1pbi1vbmx5LiBFbWl0cyBgKGFkbWluLCBwcm9wb3NlZClgLgAAAAAADXByb3Bvc2VfYWRtaW4AAAAAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAACW5ld19hZG1pbgAAAAAAABMAAAAA", "AAAAAAAAACxSZWZ1bmQgZXNjcm93IHRvIHBheWVyLiBPbmx5IHBheWVyIG1heSBjYWxsLgAAAA1yZWZ1bmRfZXNjcm93AAAAAAAAAgAAAAAAAAAKYXV0aG9yaXplcgAAAAAAEwAAAAAAAAAJZXNjcm93X2lkAAAAAAAABgAAAAEAAAPpAAAAAQAAB9AAAAALRXNjcm93RXJyb3IA", "AAAAAAAAADpSZWxlYXNlIGZ1bmRzIHRvIHBheWVlLiBBdXRob3JpemVyIG11c3QgYmUgcGF5ZXIgb3IgcGF5ZWUuAAAAAAANcmVsZWFzZV9mdW5kcwAAAAAAAAIAAAAAAAAACmF1dGhvcml6ZXIAAAAAABMAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAYAAAABAAAD6QAAAAEAAAfQAAAAC0VzY3Jvd0Vycm9yAA==", "AAAAAAAAAKZDbG9zZSB0aGUgY3VycmVudCByb3VuZCBhZnRlciBpdHMgcmV2ZWFsIGRlYWRsaW5lLiBBbnlvbmUgbWF5IGNhbGwuClJvdW5kIDAgcHJvZHVjZXMgYW4gYXBwZWFsYWJsZSBydWxpbmc7IGFuIGFwcGVhbCByb3VuZCdzIHJ1bGluZyBpcwpmaW5hbCBhbmQgcGFpZCBvdXQgaW1tZWRpYXRlbHkuAAAAAAANdGFsbHlfZGlzcHV0ZQAAAAAAAAEAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAYAAAABAAAD6QAAB9AAAAALRGlzcHV0ZUNhc2UAAAAH0AAAAAtFc2Nyb3dFcnJvcgA=", "AAAAAAAAAAAAAAANdW5wYXVzZV95aWVsZAAAAAAAAAEAAAAAAAAABWFkbWluAAAAAAAAEwAAAAEAAAPpAAAAAgAAB9AAAAALRXNjcm93RXJyb3IA", "AAAAAAAAAEdXaXRoZHJhdyB0aGUgcGVuZGluZyB1cGdyYWRlLiBBZG1pbi1vbmx5LiBFbWl0cyBgKHVwZ3JhZGUsIGNhbmNlbGxlZClgLgAAAAAOY2FuY2VsX3VwZ3JhZGUAAAAAAAEAAAAAAAAABWFkbWluAAAAAAAAEwAAAAA=", "AAAAAAAAAHhSZW1vdmUgYHRva2VuYCBmcm9tIHRoZSBkZXBvc2l0IGFsbG93bGlzdC4gRXhpc3RpbmcgZXNjcm93cyBpbiB0aGF0CnRva2VuIGNhbiBzdGlsbCBiZSByZWxlYXNlZCBvciByZWZ1bmRlZC4gQWRtaW4tb25seS4AAAAOZGlzYWxsb3dfdG9rZW4AAAAAAAIAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAQAAA+kAAAACAAAH0AAAAAtFc2Nyb3dFcnJvcgA=", "AAAAAAAAADpNYXJrIGVzY3JvdyBhcyBkaXNwdXRlZC4gRWl0aGVyIHBhcnR5IG1heSByYWlzZSBhIGRpc3B1dGUuAAAAAAAOZGlzcHV0ZV9lc2Nyb3cAAAAAAAIAAAAAAAAACmF1dGhvcml6ZXIAAAAAABMAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAYAAAABAAAD6QAAAAEAAAfQAAAAC0VzY3Jvd0Vycm9yAA==", "AAAAAAAAAFRQYXkgb3V0IGFuIHVuYXBwZWFsZWQgcm91bmQtMCBydWxpbmcgb25jZSB0aGUgYXBwZWFsIHdpbmRvdyBjbG9zZXMuCkFueW9uZSBtYXkgY2FsbC4AAAAOZXhlY3V0ZV9ydWxpbmcAAAAAAAEAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAYAAAABAAAD6QAAAAEAAAfQAAAAC0VzY3Jvd0Vycm9yAA==", "AAAAAAAAAepXaXRoZHJhdyB5aWVsZCBmb3IgYW4gZXNjcm93IHRvIHRoZSBwbGF0Zm9ybSBhZG1pbi4KCkJlaGluZCB0aGUgYFlpZWxkV2l0aGRyYXdFbmFibGVkYCBmbGFnIChkZWZhdWx0IG9mZikuIFBheXMKYG1pbihhY2NydWVkIGVudGl0bGVtZW50LCBtZWFzdXJlZCBzdXJwbHVzKWA6IHlpZWxkIGlzIHRoZSBjb250cmFjdCdzCmJhbGFuY2UgYWJvdmUgdHJhY2tlZCBwcmluY2lwYWwgKGUuZy4gcmV0dXJucyBjcmVkaXRlZCBieSBhbiBleHRlcm5hbApzdHJhdGVneSksIG5ldmVyIGEgY29tcHV0ZWQgbnVtYmVyLCBzbyB0aGlzIGNhbiBuZXZlciB0b3VjaCBhbm90aGVyCmVzY3JvdydzIHByaW5jaXBhbC4gVGhlIHNvbHZlbmN5IGNoZWNrCmBiYWxhbmNlIC0gYW1vdW50ID49IHRvdGFsX2xpYWJpbGl0aWVzYCBpcyBlbmZvcmNlZCBvbiB0aGUgdHJhbnNmZXIuCgpFdmVudDogYCh5aWVsZCwgd2l0aGRyYXduKWAg4oaSIGAoZXNjcm93X2lkLCBhbW91bnQsIGFkbWluKWAuAAAAAAAOd2l0aGRyYXdfeWllbGQAAAAAAAIAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAJZXNjcm93X2lkAAAAAAAABgAAAAEAAAPpAAAACwAAB9AAAAALRXNjcm93RXJyb3IA", "AAAAAAAAAEBTZXQgeWllbGQgY29uZmlndXJhdGlvbi4gIE9ubHkgdGhlIHBsYXRmb3JtIGFkbWluIG1heSBjYWxsIHRoaXMuAAAAD2NvbmZpZ3VyZV95aWVsZAAAAAAEAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAACHJhdGVfYnBzAAAABAAAAAAAAAAPbWF4X3lpZWxkX3JhdGlvAAAAAAQAAAAAAAAAEW1pbl9saXF1aWRpdHlfYnBzAAAAAAAABAAAAAEAAAPpAAAAAgAAB9AAAAALRXNjcm93RXJyb3IA", "AAAAAAAAAGJBcHBseSB0aGUgcGVuZGluZyB1cGdyYWRlIG9uY2UgaXRzIHRpbWVsb2NrIGhhcyBlbGFwc2VkLiBBZG1pbi1vbmx5LgpFbWl0cyBgKGNvbnRyYWN0LCB1cGdyYWRlZClgLgAAAAAAD2V4ZWN1dGVfdXBncmFkZQAAAAABAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAA", "AAAAAAAAAAAAAAAPaXNfeWllbGRfcGF1c2VkAAAAAAAAAAABAAAAAQ==", "AAAAAAAAAJZQcm9wb3NlIGEgV0FTTSB1cGdyYWRlLiBBZG1pbi1vbmx5LiBSZXR1cm5zIHRoZSBsZWRnZXIgdGltZXN0YW1wIGFmdGVyCndoaWNoIGBleGVjdXRlX3VwZ3JhZGVgIG1heSBiZSBjYWxsZWQgKG5vdyArIDQ4aCkuIEVtaXRzCmAodXBncmFkZSwgcHJvcG9zZWQpYC4AAAAAAA9wcm9wb3NlX3VwZ3JhZGUAAAAAAgAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAA1uZXdfd2FzbV9oYXNoAAAAAAAD7gAAACAAAAABAAAABg==", "AAAAAAAAAItBbmNob3IgYW4gZXZpZGVuY2UgaGFzaCBvbi1jaGFpbi4gYGhhc2hgIGlzIHRoZSBzaGEyNTYgcmV0dXJuZWQgYnkKYFBPU1QgL2FwaS9kaXNwdXRlcy86aWQvZXZpZGVuY2VgIChgZXZpZGVuY2VIYXNoYCkuIFBheWVyIG9yIHBheWVlIG9ubHkuAAAAAA9zdWJtaXRfZXZpZGVuY2UAAAAAAwAAAAAAAAAFcGFydHkAAAAAAAATAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAGAAAAAAAAAARoYXNoAAAD7gAAACAAAAABAAAD6QAAAAQAAAfQAAAAC0VzY3Jvd0Vycm9yAA==", "AAAAAAAAARNSZS1zcGxpdCB0aGUgbWlsZXN0b25lIHBsYW4gYmVmb3JlIGFueSBtaWxlc3RvbmUgaXMgcmVsZWFzZWQuCgpgaW5kaWNlc1tpXWAgZ2V0cyBgYW1vdW50c1tpXWAuIEV2ZXJ5IGxpc3RlZCBpbmRleCBtdXN0IGV4aXN0OyB0aGUgcGxhbgp0b3RhbCBhZnRlciB0aGUgYW1lbmRtZW50IG11c3QgZXF1YWwgdGhlIGVzY3JvdyBhbW91bnQgZXhhY3RseSwgYW5kIHRoZQpmZWUgaXMgcmUtYWxsb2NhdGVkLiBQYXllci1vbmx5LiBFbWl0cyBgKGVzY3JvdywgbXNfYW1lbmQpYCAoIzE3MTIpLgAAAAAQYW1lbmRfbWlsZXN0b25lcwAAAAQAAAAAAAAACmF1dGhvcml6ZXIAAAAAABMAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAYAAAAAAAAAB2luZGljZXMAAAAD6gAAAAQAAAAAAAAAB2Ftb3VudHMAAAAD6gAAAAsAAAABAAAD6QAAAAIAAAfQAAAAC0VzY3Jvd0Vycm9yAA==", "AAAAAAAAAK1QZXJzaXN0IGEgcGVuZGluZyBmZWUgaW5jcmVhc2Ugd2hvc2UgdGltZWxvY2sgaGFzIGVsYXBzZWQuIEFueW9uZSBtYXkKY2FsbCB0aGlzOyBpdCBvbmx5IHdyaXRlcyB3aGF0IGBnZXRfZmVlX2NvbmZpZ2AgYWxyZWFkeSB0cmVhdHMgYXMKZWZmZWN0aXZlLiBFbWl0cyBgKGVzY3JvdywgZmVlX3VwZClgLgAAAAAAABBhcHBseV9mZWVfdXBkYXRlAAAAAAAAAAEAAAPpAAAAAgAAB9AAAAALRXNjcm93RXJyb3IA", "AAAAAAAAACVFc2Nyb3cgaWQgYm91bmQgdG8gYGJvdW50eV9pZGAsIG9yIDAuAAAAAAAAEGdldF9ib3VuZF9lc2Nyb3cAAAABAAAAAAAAAAlib3VudHlfaWQAAAAAAAAGAAAAAQAAAAY=", "AAAAAAAAAAAAAAAQZ2V0X2Rpc3B1dGVfY2FzZQAAAAEAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAYAAAABAAAD6QAAB9AAAAALRGlzcHV0ZUNhc2UAAAAH0AAAAAtFc2Nyb3dFcnJvcgA=", "AAAAAAAAAAAAAAAQaXNfdG9rZW5fYWxsb3dlZAAAAAEAAAAAAAAABXRva2VuAAAAAAAAEwAAAAEAAAAB", "AAAAAAAAAEpTdGFrZSBgYW1vdW50YCBvZiB0aGUgc3Rha2UgdG9rZW4gdG8gam9pbiAob3IgdG9wIHVwIGluKSB0aGUgYXJiaXRlciBwb29sLgAAAAAAEHJlZ2lzdGVyX2FyYml0ZXIAAAACAAAAAAAAAAdhcmJpdGVyAAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAEAAAPpAAAH0AAAAAdBcmJpdGVyAAAAB9AAAAALRXNjcm93RXJyb3IA", "AAAAAAAAAGFXaXRoZHJhdyBhIHNjaGVkdWxlZCBmZWUgaW5jcmVhc2UgYmVmb3JlIGl0IHRha2VzIGVmZmVjdC4gQWRtaW4tb25seS4KRW1pdHMgYChlc2Nyb3csIGZlZV9jbmNsKWAuAAAAAAAAEWNhbmNlbF9mZWVfdXBkYXRlAAAAAAAAAQAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAQAAA+kAAAACAAAH0AAAAAtFc2Nyb3dFcnJvcgA=", "AAAAAAAAAMJLZWVwZXIgZW50cnlwb2ludCAoIzE3MjApOiBleHRlbmQgdGhlIGluc3RhbmNlLCBzaGFyZWQgY29uZmlnIGFuZCBldmVyeQplbnRyeSBiZWxvbmdpbmcgdG8gYGVzY3Jvd19pZHNgIHRoYXQgc3RpbGwgZXhpc3RzLiBQZXJtaXNzaW9ubGVzczsgaXQKb25seSBwYXlzIHJlbnQuIFJldHVybnMgaG93IG1hbnkgZXNjcm93cyB3ZXJlIGZvdW5kLgAAAAAAEWV4dGVuZF9lc2Nyb3dfdHRsAAAAAAAAAQAAAAAAAAAKZXNjcm93X2lkcwAAAAAD6gAAAAYAAAABAAAD6QAAAAQAAAfQAAAAC0VzY3Jvd0Vycm9yAA==", "AAAAAAAAAEdSZWFkIHRoZSBjdXJyZW50bHkgYWNjcnVlZCB5aWVsZCBmb3IgYW4gZXNjcm93IHdpdGhvdXQgbW9kaWZ5aW5nIHN0YXRlLgAAAAARZ2V0X2FjY3J1ZWRfeWllbGQAAAAAAAABAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAGAAAAAQAAAAs=", "AAAAAAAAAFtTdGF0dXMgb2YgYW4gZXNjcm93IChjaGVhcCB2aWV3IHVzZWQgYnkgdGhlIGJvdW50eSBjb250cmFjdCdzCmpvaW50LXN0YXRlIGludmFyaWFudCBjaGVjaykuAAAAABFnZXRfZXNjcm93X3N0YXR1cwAAAAAAAAEAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAYAAAABAAAD6QAAB9AAAAAMRXNjcm93U3RhdHVzAAAH0AAAAAtFc2Nyb3dFcnJvcgA=", "AAAAAAAAADFUaGUgbm9taW5hdGVkLWJ1dC1ub3QteWV0LWFjY2VwdGVkIGFkbWluLCBpZiBhbnkuAAAAAAAAEWdldF9wZW5kaW5nX2FkbWluAAAAAAAAAAAAAAEAAAPoAAAAEw==", "AAAAAAAAAIBEcmF3IGEgcGFuZWwgZm9yIGEgZGlzcHV0ZWQgZXNjcm93IHRoYXQgaGFzIG5vbmUgeWV0IChlLmcuIHRoZSBwb29sIHdhcwp0b28gc21hbGwgd2hlbiB0aGUgZGlzcHV0ZSB3YXMgcmFpc2VkKS4gQW55b25lIG1heSBjYWxsLgAAABFvcGVuX2Rpc3B1dGVfY2FzZQAAAAAAAAEAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAYAAAABAAAD6QAAB9AAAAALRGlzcHV0ZUNhc2UAAAAH0AAAAAtFc2Nyb3dFcnJvcgA=", "AAAAAAAAAHNSZWZ1bmQgYSBib3VuZCBlc2Nyb3cgdG8gdGhlIHBheWVyLiBDYWxsZWQgYnkgdGhlIGJvdW50eSBjb250cmFjdCBmcm9tCmBjYW5jZWxfYm91bnR5YCAvIGBjaGVja19hbmRfZXhwaXJlX2JvdW50eWAuAAAAABFyZWZ1bmRfZm9yX2JvdW50eQAAAAAAAAIAAAAAAAAAD2JvdW50eV9jb250cmFjdAAAAAATAAAAAAAAAAlib3VudHlfaWQAAAAAAAAGAAAAAQAAA+kAAAABAAAH0AAAAAtFc2Nyb3dFcnJvcgA=", "AAAAAAAAAUhSZWxlYXNlIGEgc2luZ2xlIG1pbGVzdG9uZSBwYXltZW50IHRvIHBheWVlLiBBdXRob3JpemVyIG11c3QgYmUgcGF5ZXIuCgpSZXF1aXJlcyB0aGUgbWlsZXN0b25lIHBsYW4gdG8gc3VtIHRvIHRoZSBlc2Nyb3cgYW1vdW50CihgTWlsZXN0b25lU3VtTWlzbWF0Y2hgIG90aGVyd2lzZSkuIEVtaXRzIGAoZXNjcm93LCBtc19yZWwpYCB3aXRoCmAoZXNjcm93X2lkLCBpbmRleCwgcGF5ZWUsIGdyb3NzLCBmZWUsIG5ldClgIHdoZXJlIGBuZXRgIGlzIHRoZSBhbW91bnQKdHJhbnNmZXJyZWQgYW5kIGBmZWVgIHRoZSBtaWxlc3RvbmUncyBzaGFyZSBvZiB0aGUgZGVwb3NpdCBmZWUuAAAAEXJlbGVhc2VfbWlsZXN0b25lAAAAAAAAAwAAAAAAAAAKYXV0aG9yaXplcgAAAAAAEwAAAAAAAAAJZXNjcm93X2lkAAAAAAAABgAAAAAAAAAFaW5kZXgAAAAAAAAEAAAAAQAAA+kAAAABAAAH0AAAAAtFc2Nyb3dFcnJvcgA=", "AAAAAAAAALpVcGRhdGUgdGhlIG1heGltdW0gYWNjZXB0YWJsZSBzbGlwcGFnZSAoYnBzKSBmb3IgeWllbGQtcHJvdG9jb2wKZGVwb3NpdHMuIE9ubHkgdGhlIHBsYXRmb3JtIGFkbWluIG1heSBjYWxsIHRoaXMuIERlZmF1bHRzIHRvCmBERUZBVUxUX01BWF9TTElQUEFHRV9CUFNgICgxICUpIHVudGlsIGV4cGxpY2l0bHkgY29uZmlndXJlZC4AAAAAABJjb25maWd1cmVfc2xpcHBhZ2UAAAAAAAIAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAQbWF4X3NsaXBwYWdlX2JwcwAAAAQAAAABAAAD6QAAAAIAAAfQAAAAC0VzY3Jvd0Vycm9yAA==", "AAAAAAAAAHJQYXkgYSBib3VuZCBlc2Nyb3cgb3V0IHRvIGBwYXllZWAgKHRoZSBzZWxlY3RlZCBmcmVlbGFuY2VyKS4gQ2FsbGVkIGJ5CnRoZSBib3VudHkgY29udHJhY3QgZnJvbSBgY29tcGxldGVfYm91bnR5YC4AAAAAABJyZWxlYXNlX2Zvcl9ib3VudHkAAAAAAAMAAAAAAAAAD2JvdW50eV9jb250cmFjdAAAAAATAAAAAAAAAAlib3VudHlfaWQAAAAAAAAGAAAAAAAAAAVwYXllZQAAAAAAABMAAAABAAAD6QAAAAEAAAfQAAAAC0VzY3Jvd0Vycm9yAA==", "AAAAAAAAAEhTZXQgdGhlIG9yYWNsZSBjb250cmFjdCBhZGRyZXNzLiBPbmx5IGdvdmVybmFuY2UgbXVsdGlzaWcgbWF5IGNhbGwgdGhpcy4AAAASc2V0X29yYWNsZV9hZGRyZXNzAAAAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAABm9yYWNsZQAAAAAAEwAAAAEAAAPpAAAAAgAAB9AAAAALRXNjcm93RXJyb3IA", "AAAAAAAAAdRTdWJtaXQgYSBTdGVsbGFyIHRyYW5zYWN0aW9uIGZvciBhbiBlc2Nyb3cgb3BlcmF0aW9uLgoKVGhpcyBpcyB0aGUgb24tY2hhaW4gZW50cnkgcG9pbnQgY2FsbGVkIGJ5IHRoZSBiYWNrZW5kIFN0ZWxsYXIgU0RLCmFmdGVyIGJ1aWxkaW5nIGFuZCBzaWduaW5nIGEgdHJhbnNhY3Rpb24gZW52ZWxvcGUuIEl0IHZhbGlkYXRlcyB0aGUKb3BlcmF0aW9uIHR5cGUgYW5kIGRlbGVnYXRlcyB0byB0aGUgYXBwcm9wcmlhdGUgZXNjcm93IGZ1bmN0aW9uLgoKYG9wZXJhdGlvbmA6IG9uZSBvZiAicmVsZWFzZSIsICJyZWZ1bmQiLCAiZGlzcHV0ZSIuICJkZXBvc2l0IiBhbmQgYW55Cm90aGVyIHZhbHVlIGZhaWwgd2l0aCBgVW5zdXBwb3J0ZWRPcGVyYXRpb25gICh1c2UgYGRlcG9zaXQoKWAgZGlyZWN0bHkpLgpgZXNjcm93X2lkYDogdGFyZ2V0IGVzY3JvdwpSZXR1cm5zIHRoZSBlc2Nyb3dfaWQgdGhhdCB3YXMgYWN0ZWQgdXBvbi4AAAASc3VibWl0X3RyYW5zYWN0aW9uAAAAAAADAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAACW9wZXJhdGlvbgAAAAAAABEAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAYAAAABAAAD6QAAAAYAAAfQAAAAC0VzY3Jvd0Vycm9yAA==", "AAAAAAAAAAAAAAATZ2V0X2JvdW50eV9jb250cmFjdAAAAAAAAAAAAQAAA+gAAAAT", "AAAAAAAAAJxWZXJpZmllZCBvdXRjb21lIG9mIGEgcmVzb2x2ZWQgZGlzcHV0ZSwgaWYgdGhlIGVzY3JvdyB3YXMgZGlzcHV0ZWQgYW5kCnNldHRsZWQgKCMxNzExKS4gYE5vbmVgIGZvciBlc2Nyb3dzIHRoYXQgd2VyZSBuZXZlciBkaXNwdXRlZCBvciBhcmUKc3RpbGwgaW4gZGlzcHV0ZS4AAAATZ2V0X2Rpc3B1dGVfb3V0Y29tZQAAAAABAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAAGAAAAAQAAA+gAAAfQAAAADkRpc3B1dGVPdXRjb21lAAA=", "AAAAAAAAADdUaGUgdXBncmFkZSBjdXJyZW50bHkgd2FpdGluZyBvdXQgaXRzIHRpbWVsb2NrLCBpZiBhbnkuAAAAABNnZXRfcGVuZGluZ191cGdyYWRlAAAAAAAAAAABAAAD6AAAB9AAAAAOUGVuZGluZ1VwZ3JhZGUAAA==", "AAAAAAAAAUhDb3VudCBwcmluY2lwYWwgb2YgZXNjcm93cyBjcmVhdGVkIGJlZm9yZSBsaWFiaWxpdHkgdHJhY2tpbmcgZXhpc3RlZAooIzE3MDYpLiBBZG1pbi1vbmx5LCBpZGVtcG90ZW50OyBwcm9jZXNzZXMgaWRzIGBmcm9tX2lkLi49dG9faWRgIGFuZApyZXR1cm5zIGhvdyBtYW55IGVzY3Jvd3Mgd2VyZSBuZXdseSBjb3VudGVkLiBSdW4gb3ZlciBhbGwgZXhpc3RpbmcKaWRzIGJlZm9yZSBlbmFibGluZyBgd2l0aGRyYXdfeWllbGRgIG9uIGFuIHVwZ3JhZGVkIGNvbnRyYWN0LgoKRXZlbnQ6IGAoZXNjcm93LCBsaWFiX21pZylgIOKGkiBgKGZyb21faWQsIHRvX2lkLCBjb3VudGVkKWAuAAAAE21pZ3JhdGVfbGlhYmlsaXRpZXMAAAAAAwAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAdmcm9tX2lkAAAAAAYAAAAAAAAABXRvX2lkAAAAAAAABgAAAAEAAAPpAAAABAAAB9AAAAALRXNjcm93RXJyb3IA", "AAAAAAAAAEhSZWdpc3RlciB0aGUgYm91bnR5IGNvbnRyYWN0IHRydXN0ZWQgdG8gZHJpdmUgYm91bmQgZXNjcm93cy4gQWRtaW4tb25seS4AAAATc2V0X2JvdW50eV9jb250cmFjdAAAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAAD2JvdW50eV9jb250cmFjdAAAAAATAAAAAQAAA+kAAAACAAAH0AAAAAtFc2Nyb3dFcnJvcgA=", "AAAAAAAAAVdEZXBvc2l0IGZ1bmRzIGludG8gZXNjcm93LCByZXZlcnRpbmcgd2l0aCBgRmVlRXhjZWVkc01heGAgaWYgdGhlCnBsYXRmb3JtIGZlZSBjaGFyZ2VkIHdvdWxkIGV4Y2VlZCBgbWF4X2ZlZWAgdG9rZW4gdW5pdHMgKCMxNzI0KS4KCkNsaWVudHMgb2J0YWluIGBtYXhfZmVlYCBmcm9tIGBlc3RpbWF0ZV9mdW5kX2VzY3Jvd19mZWVgIGF0IHF1b3RlIHRpbWUKKG9wdGlvbmFsbHkgcGx1cyBhIHRvbGVyYW5jZSB0aGUgdXNlciBhY2NlcHRlZCkgYW5kIHBhc3MgaXQgaGVyZSwgc28gYQpmZWUgY2hhbmdlIGJldHdlZW4gcXVvdGUgYW5kIGV4ZWN1dGlvbiBjYW4gbmV2ZXIgb3Zlci1jaGFyZ2UgdGhlIHVzZXIuAAAAABRkZXBvc2l0X3dpdGhfbWF4X2ZlZQAAAAcAAAAAAAAACWJvdW50eV9pZAAAAAAAAAYAAAAAAAAABXBheWVyAAAAAAAAEwAAAAAAAAAFcGF5ZWUAAAAAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAARcmVsZWFzZV9jb25kaXRpb24AAAAAAAfQAAAAEFJlbGVhc2VDb25kaXRpb24AAAAAAAAAB21heF9mZWUAAAAACwAAAAEAAAPpAAAABgAAB9AAAAALRXNjcm93RXJyb3IA", "AAAAAAAAAExXaXRoZHJhdyBhIHBlbmRpbmcgYWRtaW4gbm9taW5hdGlvbi4gQWRtaW4tb25seS4gRW1pdHMgYChhZG1pbiwgY2FuY2VsbGVkKWAuAAAAFWNhbmNlbF9hZG1pbl90cmFuc2ZlcgAAAAAAAAEAAAAAAAAABWFkbWluAAAAAAAAEwAAAAA=", "AAAAAAAAAHxPbmUtdGltZSBzZXR1cCBvZiB0aGUgYXJiaXRlciBzdGFrZSB0b2tlbiBhbmQgbWluaW11bSBzdGFrZS4gVGhlIGFkbWluCmNhbm5vdCBjaGFuZ2UgaXQgbGF0ZXIgYW5kIGhhcyBubyBzYXkgaW4gYW55IG91dGNvbWUuAAAAFWNvbmZpZ3VyZV9hcmJpdHJhdGlvbgAAAAAAAAMAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAALc3Rha2VfdG9rZW4AAAAAEwAAAAAAAAAJbWluX3N0YWtlAAAAAAAACwAAAAEAAAPpAAAAAgAAB9AAAAALRXNjcm93RXJyb3IA", "AAAAAAAAADJNaWxlc3RvbmUgaW5kaWNlcyBvZiBhbiBlc2Nyb3csIGluIGNyZWF0aW9uIG9yZGVyLgAAAAAAFWdldF9taWxlc3RvbmVfaW5kaWNlcwAAAAAAAAEAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAYAAAABAAAD6gAAAAQ=", "AAAAAAAAADxUb3RhbCBwcmluY2lwYWwgdGhlIGNvbnRyYWN0IHN0aWxsIG93ZXMgZm9yIGB0b2tlbmAgKCMxNzA2KS4AAAAVZ2V0X3RvdGFsX2xpYWJpbGl0aWVzAAAAAAAAAQAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAQAAAAs=", "AAAAAAAAATNSZWZ1bmQgYW4gZXhwaXJlZCBib3VudHkncyBlc2Nyb3cgdG8gdGhlIHBheWVyLiBDYWxsZWQgYnkgdGhlIGJvdW50eQpjb250cmFjdCB3aGVuIGV4cGlyaW5nLiAjMTcxNDogYGJvdW50eV9jb250cmFjdGAgbXVzdCBiZSB0aGUgY29udHJhY3QKcmVnaXN0ZXJlZCB2aWEgYHNldF9ib3VudHlfY29udHJhY3RgIChhbnkgY29udHJhY3QgdXNlZCB0byBiZSBhYmxlIHRvCnJlZnVuZCBhbnkgYm91bnR5J3MgZXNjcm93KS4gS2VwdCBmb3Igb2xkZXIgYm91bnR5IGRlcGxveW1lbnRzOyBuZXcKb25lcyBjYWxsIGByZWZ1bmRfZm9yX2JvdW50eWAuAAAAABVyZWZ1bmRfZXhwaXJlZF9ib3VudHkAAAAAAAACAAAAAAAAAAlib3VudHlfaWQAAAAAAAAGAAAAAAAAAA9ib3VudHlfY29udHJhY3QAAAAAEwAAAAEAAAPpAAAAAQAAB9AAAAALRXNjcm93RXJyb3IA", "AAAAAAAAAAAAAAAWZ2V0X2FyYml0cmF0aW9uX2NvbmZpZwAAAAAAAAAAAAEAAAPpAAAH0AAAABFBcmJpdHJhdGlvbkNvbmZpZwAAAAAAB9AAAAALRXNjcm93RXJyb3IA", "AAAAAAAAAGtSZXR1cm5zIG1pbGVzdG9uZSBwcm9ncmVzcyBmb3IgYW4gZXNjcm93OiAocmVsZWFzZWRfY291bnQsIG1pbGVzdG9uZV9jb3VudCwgcmVsZWFzZWRfYW1vdW50LCB0b3RhbF9hbW91bnQpLgAAAAAWZ2V0X21pbGVzdG9uZV9wcm9ncmVzcwAAAAAAAQAAAAAAAAAJZXNjcm93X2lkAAAAAAAABgAAAAEAAAPtAAAABAAAAAQAAAAEAAAACwAAAAs=", "AAAAAAAAAEJUaGUgc2NoZWR1bGVkIGZlZSBpbmNyZWFzZSBzdGlsbCB3YWl0aW5nIG91dCBpdHMgdGltZWxvY2ssIGlmIGFueS4AAAAAABZnZXRfcGVuZGluZ19mZWVfY29uZmlnAAAAAAAAAAAAAQAAA+gAAAfQAAAAEFBlbmRpbmdGZWVDb25maWc=", "AAAAAAAAAERXaXRoZHJhdyBzdGFrZS4gTm90IGFsbG93ZWQgd2hpbGUgdGhlIGFyYml0ZXIgc2l0cyBvbiBhbiBvcGVuIHBhbmVsLgAAABZ3aXRoZHJhd19hcmJpdGVyX3N0YWtlAAAAAAACAAAAAAAAAAdhcmJpdGVyAAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAEAAAPpAAAACwAAB9AAAAALRXNjcm93RXJyb3IA", "AAAAAAAAAVNGYWxsYmFjayBmb3IgYSBkaXNwdXRlIHRoYXQgbmV2ZXIgZ290IGEgcGFuZWwgKG5vIG9yIHRvbyBmZXcgYXJiaXRlcnMpCm9uY2UgaXRzIGV4cGlyeSB3aW5kb3cgaGFzIGVsYXBzZWQ6IGZpeGVkIDUwLzUwIHNwbGl0LiBBbnlvbmUgbWF5IGNhbGwuCgpGYWlscyB3aXRoOgotIGBFc2Nyb3dOb3REaXNwdXRlZGAgaWYgZXNjcm93IGlzIG5vdCBpbiBEaXNwdXRlZCBzdGF0ZQotIGBDYXNlQWxyZWFkeU9wZW5gIGlmIGFuIGFyYml0ZXIgcGFuZWwgaXMgaGFuZGxpbmcgdGhlIGRpc3B1dGUKLSBgRGlzcHV0ZU5vdEV4cGlyZWRgIGlmIHRoZSBleHBpcnkgd2luZG93IGhhcyBub3QgeWV0IGVsYXBzZWQAAAAAF3Jlc29sdmVfZXhwaXJlZF9kaXNwdXRlAAAAAAEAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAYAAAABAAAD6QAAAAEAAAfQAAAAC0VzY3Jvd0Vycm9yAA==", "AAAAAAAAAYxRdW90ZSB0aGUgcGxhdGZvcm0gZmVlIGZvciBmdW5kaW5nIGFuIGVzY3JvdyB3aXRoIGBhbW91bnRgLgoKVXNlcyB0aGUgZmVlIGNvbmZpZyBlZmZlY3RpdmUgKm5vdyouIFBhc3MgdGhlIHJlc3VsdCAocGx1cyBhbnkKdG9sZXJhbmNlIHRoZSB1c2VyIGFjY2VwdHMpIGFzIGBtYXhfZmVlYCB0byBgZGVwb3NpdF93aXRoX21heF9mZWVgOiBpZgpnb3Zlcm5hbmNlIHJhaXNlcyB0aGUgZmVlIGJlZm9yZSB0aGUgdHJhbnNhY3Rpb24gbGFuZHMsIHRoZSBkZXBvc2l0CnJldmVydHMgaW5zdGVhZCBvZiBvdmVyLWNoYXJnaW5nICgjMTcyNCkuIEZlZSBpbmNyZWFzZXMgYXJlIGFsc28KdGltZWxvY2tlZCBieSBgRkVFX0NIQU5HRV9ERUxBWV9TRUNTYDsgc2VlIGBnZXRfcGVuZGluZ19mZWVfY29uZmlnYC4AAAAYZXN0aW1hdGVfZnVuZF9lc2Nyb3dfZmVlAAAAAQAAAAAAAAAGYW1vdW50AAAAAAALAAAAAQAAAAs=", "AAAAAAAAAAAAAAAYZ2V0X2FjdGl2ZV9lc2Nyb3dzX2NvdW50AAAAAAAAAAEAAAAG", "AAAAAAAAAEJUaGUgZmVlIGNvbmZpZyBjdXJyZW50bHkgaW4gZWZmZWN0IChpbmNsdWRpbmcgYSBtYXR1cmVkIGluY3JlYXNlKS4AAAAAABhnZXRfZWZmZWN0aXZlX2ZlZV9jb25maWcAAAAAAAAAAQAAB9AAAAAJRmVlQ29uZmlnAAAA", "AAAAAAAAAC9HZXQgdGhlIGxhdGVzdCBlc2Nyb3cgSUQgZm9yIGEgc3BlY2lmaWMgYm91bnR5LgAAAAAYZ2V0X2VzY3Jvd19pZF9mb3JfYm91bnR5AAAAAQAAAAAAAAAJYm91bnR5X2lkAAAAAAAABgAAAAEAAAAG", "AAAAAAAAAGZSZXR1cm4gdGhlIG9yYWNsZSBzdGFsZW5lc3MgdGhyZXNob2xkIGluIHNlY29uZHMgKGdvdmVybmFuY2UtY29uZmlndXJhYmxlKS4KRGVmYXVsdHMgdG8gMzYwMCAoMSBob3VyKS4AAAAAABlnZXRfb3JhY2xlX3N0YWxlbmVzc19zZWNzAAAAAAAAAAAAAAEAAAAG", "AAAAAAAAAAAAAAAZaXNfeWllbGRfd2l0aGRyYXdfZW5hYmxlZAAAAAAAAAAAAAABAAAAAQ==", "AAAAAAAAAEtTZXQgdGhlIG9yYWNsZSBzdGFsZW5lc3MgdGhyZXNob2xkLiBPbmx5IGdvdmVybmFuY2UgbXVsdGlzaWcgbWF5IGNhbGwgdGhpcy4AAAAAGXNldF9vcmFjbGVfc3RhbGVuZXNzX3NlY3MAAAAAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAADnN0YWxlbmVzc19zZWNzAAAAAAAGAAAAAQAAA+kAAAACAAAH0AAAAAtFc2Nyb3dFcnJvcgA=", "AAAAAAAAAHVFbmFibGUgb3IgZGlzYWJsZSBgd2l0aGRyYXdfeWllbGRgICgjMTcwNikuIERpc2FibGVkIGJ5IGRlZmF1bHQuCkFkbWluLW9ubHkuIEV2ZW50OiBgKHlpZWxkLCB3ZF9mbGFnKWAg4oaSIGBlbmFibGVkYC4AAAAAAAAac2V0X3lpZWxkX3dpdGhkcmF3X2VuYWJsZWQAAAAAAAIAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAHZW5hYmxlZAAAAAABAAAAAQAAA+kAAAACAAAH0AAAAAtFc2Nyb3dFcnJvcgA=", "AAAABAAAAK1FcnJvcnMgcmFpc2VkIGJ5IHRoZSBzaGFyZWQgdXBncmFkZS9hZG1pbiBoZWxwZXJzLgoKQ29kZXMgc3RhcnQgYXQgOTAwIHNvIHRoZXkgZG9uJ3Qgb3ZlcmxhcCBhbnkgY29udHJhY3QncyBvd24gZXJyb3IgZW51bTsKdGhleSBzdXJmYWNlIG9uLWNoYWluIGFzIGBFcnJvcihDb250cmFjdCwgIzl4eClgLgAAAAAAAAAAAAAMVXBncmFkZUVycm9yAAAABgAAAB9DYWxsZXIgaXMgbm90IHRoZSBzdG9yZWQgYWRtaW4uAAAAAAxVbmF1dGhvcml6ZWQAAAOEAAAAQWBleGVjdXRlX3VwZ3JhZGVgIC8gYGNhbmNlbF91cGdyYWRlYCBjYWxsZWQgd2l0aCBub3RoaW5nIHBlbmRpbmcuAAAAAAAAEE5vUGVuZGluZ1VwZ3JhZGUAAAOFAAAAMGBleGVjdXRlX3VwZ3JhZGVgIGNhbGxlZCBiZWZvcmUgYGV4ZWN1dGFibGVfYXRgLgAAABJUaW1lbG9ja05vdEVsYXBzZWQAAAAAA4YAAABFYGFjY2VwdF9hZG1pbmAgLyBgY2FuY2VsX2FkbWluX3RyYW5zZmVyYCBjYWxsZWQgd2l0aCBub3RoaW5nIHBlbmRpbmcuAAAAAAAADk5vUGVuZGluZ0FkbWluAAAAAAOHAAAAO2BhY2NlcHRfYWRtaW5gIHNpZ25lZCBieSBhbiBhZGRyZXNzIG90aGVyIHRoYW4gdGhlIG5vbWluZWUuAAAAAA9Ob3RQZW5kaW5nQWRtaW4AAAADiAAAACxgcHJvcG9zZV9hZG1pbmAgbm9taW5hdGVkIHRoZSBjdXJyZW50IGFkbWluLgAAAAlTYW1lQWRtaW4AAAAAAAOJ", "AAAAAQAAADFBIHByb3Bvc2VkIGNvZGUgdXBncmFkZSB3YWl0aW5nIG91dCBpdHMgdGltZWxvY2suAAAAAAAAAAAAAA5QZW5kaW5nVXBncmFkZQAAAAAAAwAAAAAAAAANZXhlY3V0YWJsZV9hdAAAAAAAAAYAAAAAAAAAC3Byb3Bvc2VkX2F0AAAAAAYAAAAAAAAACXdhc21faGFzaAAAAAAAA+4AAAAg"]),
      options
    );
  }

   static deploy<T = Client>({ admin }: { admin: string | Address }, options: MethodOptions & Omit<ContractClientOptions, 'contractId'> & { wasmHash: Buffer | string; salt?: Buffer | Uint8Array; format?: "hex" | "base64"; address?: string; }): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({ admin }, options);
  }
  public readonly fromJSON = {
    deposit : this.txFromJSON<Result<bigint, EscrowError>>,  get_admin : this.txFromJSON<Result<string, EscrowError>>,  get_escrow : this.txFromJSON<Result<EscrowAccount, EscrowError>>,  update_fee : this.txFromJSON<Result<null, EscrowError>>,  allow_token : this.txFromJSON<Result<null, EscrowError>>,  bind_bounty : this.txFromJSON<Result<boolean, EscrowError>>,  can_release : this.txFromJSON<Result<boolean, EscrowError>>,  commit_vote : this.txFromJSON<Result<null, EscrowError>>,  get_arbiter : this.txFromJSON<Result<Arbiter, EscrowError>>,  get_surplus : this.txFromJSON<bigint>,  pause_yield : this.txFromJSON<Result<null, EscrowError>>,  reveal_vote : this.txFromJSON<Result<null, EscrowError>>,  accept_admin : this.txFromJSON<void>,  accrue_yield : this.txFromJSON<Result<null, EscrowError>>,  get_evidence : this.txFromJSON<Array<Evidence>>,  add_milestone : this.txFromJSON<Result<null, EscrowError>>,  appeal_ruling : this.txFromJSON<Result<DisputeCase, EscrowError>>,  calculate_fee : this.txFromJSON<bigint>,  get_milestone : this.txFromJSON<Result<Milestone, EscrowError>>,  propose_admin : this.txFromJSON<void>,  refund_escrow : this.txFromJSON<Result<boolean, EscrowError>>,  release_funds : this.txFromJSON<Result<boolean, EscrowError>>,  tally_dispute : this.txFromJSON<Result<DisputeCase, EscrowError>>,  unpause_yield : this.txFromJSON<Result<null, EscrowError>>,  cancel_upgrade : this.txFromJSON<void>,  disallow_token : this.txFromJSON<Result<null, EscrowError>>,  dispute_escrow : this.txFromJSON<Result<boolean, EscrowError>>,  execute_ruling : this.txFromJSON<Result<boolean, EscrowError>>,  withdraw_yield : this.txFromJSON<Result<bigint, EscrowError>>,  configure_yield : this.txFromJSON<Result<null, EscrowError>>,  execute_upgrade : this.txFromJSON<void>,  is_yield_paused : this.txFromJSON<boolean>,  propose_upgrade : this.txFromJSON<bigint>,  submit_evidence : this.txFromJSON<Result<number, EscrowError>>,  amend_milestones : this.txFromJSON<Result<null, EscrowError>>,  apply_fee_update : this.txFromJSON<Result<null, EscrowError>>,  get_bound_escrow : this.txFromJSON<bigint>,  get_dispute_case : this.txFromJSON<Result<DisputeCase, EscrowError>>,  is_token_allowed : this.txFromJSON<boolean>,  register_arbiter : this.txFromJSON<Result<Arbiter, EscrowError>>,  cancel_fee_update : this.txFromJSON<Result<null, EscrowError>>,  extend_escrow_ttl : this.txFromJSON<Result<number, EscrowError>>,  get_accrued_yield : this.txFromJSON<bigint>,  get_escrow_status : this.txFromJSON<Result<EscrowStatus, EscrowError>>,  get_pending_admin : this.txFromJSON<string | null>,  open_dispute_case : this.txFromJSON<Result<DisputeCase, EscrowError>>,  refund_for_bounty : this.txFromJSON<Result<boolean, EscrowError>>,  release_milestone : this.txFromJSON<Result<boolean, EscrowError>>,  configure_slippage : this.txFromJSON<Result<null, EscrowError>>,  release_for_bounty : this.txFromJSON<Result<boolean, EscrowError>>,  set_oracle_address : this.txFromJSON<Result<null, EscrowError>>,  submit_transaction : this.txFromJSON<Result<bigint, EscrowError>>,  get_bounty_contract : this.txFromJSON<string | null>,  get_dispute_outcome : this.txFromJSON<DisputeOutcome | null>,  get_pending_upgrade : this.txFromJSON<PendingUpgrade | null>,  migrate_liabilities : this.txFromJSON<Result<number, EscrowError>>,  set_bounty_contract : this.txFromJSON<Result<null, EscrowError>>,  deposit_with_max_fee : this.txFromJSON<Result<bigint, EscrowError>>,  cancel_admin_transfer : this.txFromJSON<void>,  configure_arbitration : this.txFromJSON<Result<null, EscrowError>>,  get_milestone_indices : this.txFromJSON<Array<number>>,  get_total_liabilities : this.txFromJSON<bigint>,  refund_expired_bounty : this.txFromJSON<Result<boolean, EscrowError>>,  get_arbitration_config : this.txFromJSON<Result<ArbitrationConfig, EscrowError>>,  get_milestone_progress : this.txFromJSON<[number, number, bigint, bigint]>,  get_pending_fee_config : this.txFromJSON<PendingFeeConfig | null>,  withdraw_arbiter_stake : this.txFromJSON<Result<bigint, EscrowError>>,  resolve_expired_dispute : this.txFromJSON<Result<boolean, EscrowError>>,  estimate_fund_escrow_fee : this.txFromJSON<bigint>,  get_active_escrows_count : this.txFromJSON<bigint>,  get_effective_fee_config : this.txFromJSON<FeeConfig>,  get_escrow_id_for_bounty : this.txFromJSON<bigint>,  get_oracle_staleness_secs : this.txFromJSON<bigint>,  is_yield_withdraw_enabled : this.txFromJSON<boolean>,  set_oracle_staleness_secs : this.txFromJSON<Result<null, EscrowError>>,  set_yield_withdraw_enabled : this.txFromJSON<Result<null, EscrowError>>
  };

}