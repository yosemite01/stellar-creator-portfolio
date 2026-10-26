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

## Deferred

Wallet-level Sybil resistance (one person, many wallets, each a "new user")
is not addressed. KYC-gating reward claims would be the next step.
