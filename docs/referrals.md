# Referral anti-abuse rules

Referral rewards pay out real tokens, so the on-chain contract
([`backend/contracts/referral/src/lib.rs`](../backend/contracts/referral/src/lib.rs))
and the API ([`lib/services/referral-service.ts`](../lib/services/referral-service.ts))
both reject referrals that would let one person farm rewards (Issue #1566).

## Threat

Before this change, `register_referral(referrer, referred)` required no
signature and checked only that `referred` had not been referred already.
Anyone could register their own second wallet, or register themselves as
their own referrer. Two colluding accounts could also refer each other
(A→B, then B→A) so that rewards flowed in a circle.

## On-chain rules

`register_referral` must now be **signed by `referred`**. It fails with:

| Code | Variant | Rule |
|---|---|---|
| 7 | `SelfReferral` | `referrer == referred` |
| 3 | `ReferralAlreadyRegistered` | `referred` already has a referrer |
| 8 | `ReferralLoop` | `referrer` was referred by `referred` (a two-account loop) |
| 9 | `RefereeIsReferrer` | `referred` has already referred someone |

The new variants are appended after the existing `ReferralError` codes (see
[contracts.md](contracts.md)); existing codes are never renumbered.

The `RefereeIsReferrer` rule means every referee is a new participant. A cycle of any length needs
some account to be referred after it has already referred someone, so this
rule blocks all cycles with one O(1) storage read. It relies on the new
`HasReferred(Address)` storage key. `ReferralLoop` also covers referrers who were
registered before that key existed. The 50-per-referrer-per-month cap is
unchanged.

## Off-chain rules

`POST /api/referrals` records a referral only for the signed-in user. It
applies per-user rate limiting (10/min) and an IP fraud window (3 per IP per
hour). It now also rejects:

- a second referrer for a user who already has one: `409 duplicate`
- a referrer who was referred by the caller, or a caller who has already
  referred others: `422 referral_loop`

## Rewards tied to real activity (Issue #1716)

Self-referral with fresh wallets is cheap, so rewards are now gated on
activity and backed by a funded pool.

- **Qualifying activity.** `award_referral_reward(referred, platform_fee,
  bounty_id)` (admin-only) calls the bounty contract's
  `is_qualifying_bounty(bounty_id, referred)`. It is `true` only when the
  bounty is `Completed`, was funded through escrow, and `referred` is its
  creator or selected freelancer. Each `bounty_id` pays at most one reward.
  Configure the bounty contract with `set_bounty_contract(admin, bounty)`.
- **Risk attestations.** `set_risk_attestor(admin, Some(attestor))` turns on
  the off-chain risk check. `register_referral(referrer, referred,
  attestation_expires_at)` then also needs the attestor's authorization of
  `(referrer, referred, expires_at)`. The risk service gives that signature
  only when the pair shows no self-referral or shared-funding-source signal.
- **Funded pool.** `fund_pool(funder, amount)` transfers reward tokens into
  the contract. Each award reserves its amount from the pool (clamped to
  what is available) so every unclaimed reward is backed. An empty pool
  returns `PoolEmpty` instead of accruing an unbacked balance, and
  `claim_referral_reward` also returns `PoolEmpty` rather than trapping if
  the contract balance is short. `get_pool()` returns
  `(available, reserved)`.
- **Per-period cap.** A referrer earns at most `set_reward_cap(admin, cap)`
  (default `DEFAULT_REWARD_CAP`) per 30-day period; the last award is
  clamped and further ones fail with `RewardCapReached`.

Events: `(referral, funded)`, `(referral, reward)` now carries `bounty_id`,
`(referral, bounty)`, `(referral, attestor)`, `(referral, cap)`.

**Breaking for callers:** `register_referral` takes a third argument
(`Option<u64>`, pass `None` when no attestor is configured) and
`award_referral_reward` takes `bounty_id` and returns the amount awarded.

## Deferred

KYC-gating reward claims is still not implemented.
