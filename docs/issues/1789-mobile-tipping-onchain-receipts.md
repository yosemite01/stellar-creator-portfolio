# 📌 Issue Preview: Mobile tipping flow with on-chain payments and receipt verification

**Labels:** `mobile`, `payments`, `stellar`, `soroban`, `hard`

**Issue:** #1789 · **Size:** L · **Pinned commit:** `dd8420b`

---

### Description
The tipping UI and the state machine for optimistic updates exist, but the on-chain part does
not work yet. No real transaction is built or signed, "success" is reported as soon as the RPC
accepts a submission rather than when the payment confirms, and retries can send the same tip
twice. This code moves real money, so it needs real XDR, a wallet signature, confirmation on
the ledger, idempotent retries, and a receipt that can be checked.

### Current Behavior (as found in code)

| Location | What it does today | Problem |
|---|---|---|
| [TippingService.ts](../../mobile/src/tipping/TippingService.ts#L133-L154) `buildTipOperationXDR` | Returns `JSON.stringify({ contractId, method, args })` | **This isn't XDR.** It has no source account, sequence number, fee, footprint or signature. |
| [TippingService.ts](../../mobile/src/tipping/TippingService.ts#L170-L180) | POSTs that JSON as `params.xdr` to `sendTransaction` | Every real RPC rejects it. Nothing ever signs it. The wallet integration ([MultiAccountService.signTransaction](../../mobile/src/services/MultiAccountService.ts#L265-L294) / WalletConnect) is not called. |
| [TippingService.ts](../../mobile/src/tipping/TippingService.ts#L206-L212) | Returns `status: 'success'` when the RPC returns a hash | `sendTransaction` returns `PENDING` or `DUPLICATE`, which means the transaction was *accepted for submission*, not applied. It can still fail on the ledger, and the UI would show success for money that never moved. |
| [TippingService.ts](../../mobile/src/tipping/TippingService.ts#L138) | `BigInt(Math.round(parseFloat(amount) * 1e7))` | Float math on money, so `"0.1"` and similar values carry rounding risk. It assumes 7 decimals for every asset. |
| [TippingService.ts](../../mobile/src/tipping/TippingService.ts#L46-L51) `TipLock` | An in-memory `Set` keyed by `idempotencyKey` | The only dedupe. The lock is released on rollback, and it is lost when the app is killed. If the app is killed after submission, or a timeout triggers a retry with a new key, the tip is sent **twice**. |
| [TippingService.ts](../../mobile/src/tipping/TippingService.ts#L72-L94) `beginTip` | Optimistic balance from a number passed to the constructor | The balance is never reconciled with the chain. |
| `useTipping` | Rolls back on any thrown error | A network timeout *after* the transaction was submitted rolls back the UI even though the tip may land on-chain. The user sees "failed" and tips again. |
| — | No receipts | Nothing is persisted or verifiable after the session ends. |

### Design note

#### State machine (persisted, not just in memory)
```
draft → built → signed → submitted → confirmed
                   ↘         ↘            
                 cancelled   failed (definitive, on-ledger or pre-submit)
                             unknown (timeout after submit → must reconcile, never auto-retry with new tx)
```
- Each tip is a `TipIntent` stored in WatermelonDB (new `tip_intents` table) or SecureStore
  metadata, with these fields: `id` (= idempotencyKey, a UUID created once when the user
  taps), `from`, `to`, `asset`, `amountStroops` (a string), `memo`, `txHash?`,
  `signedXdr?`, `status`, `ledger?`, `createdAt`, `updatedAt`.
- **The idempotency rule:** once a tip has a `signedXdr`, every retry resubmits **the same
  signed XDR**. Its sequence number is fixed, so Stellar itself guarantees it can apply at
  most once. A new transaction is built only when the earlier one is *proven* dead: its
  `timeBounds.maxTime` has passed and `getTransaction` returns `NOT_FOUND`, or it returned a
  definitive `FAILED`.
- Every transaction sets `timeBounds` to now + 60 s, so "unknown" always resolves within a
  minute.

#### Building and signing (`mobile/src/tipping/TipTransactionBuilder.ts`)
- Use `@stellar/stellar-sdk`:
  1. `server.getAccount(from)`;
  2. `Contract(TIPPING_CONTRACT_ID).call('tip', Address(to), nativeToScVal(amount, {type:'i128'}))`;
  3. `TransactionBuilder` with `timeBounds` and the memo;
  4. `server.prepareTransaction()` (simulate, then footprint and resource fee).
- For a classic XLM or USDC tip without the contract, use `Operation.payment`. Choose this by
  config flag. Both paths share the confirm and receipt logic.
- Parse amounts with a decimal string parser (`parseAmountToStroops("1.2345678")` → `12345678n`),
  using the asset's decimals. Reject anything with more decimals than the asset allows, as
  well as negative values, zero, and values above a configured per-tip max.
- Signing goes through one interface,
  `WalletSigner { signTransaction(xdr, networkPassphrase): Promise<string> }`, with
  implementations for `MultiAccountService` (local keys; biometric-gated per #1787) and
  WalletConnect. If the user cancels, the tip becomes `cancelled` and the balance rolls back.

#### Confirmation (`TipConfirmer.ts`)
- `sendTransaction(signedXdr)`:
  - `PENDING` or `DUPLICATE` moves the tip to `submitted`;
  - `ERROR` with a definitive result code moves it to `failed`;
  - `TRY_AGAIN_LATER` means back off and resubmit the same XDR.
- Then poll `getTransaction(hash)` with backoff (1 s, 2 s, 4 s, capped, until `maxTime` +
  ledger close margin):
  - `SUCCESS` moves the tip to `confirmed` and records the ledger;
  - `FAILED` moves it to `failed`;
  - still `NOT_FOUND` after `maxTime` means it is definitively dead, so `failed` (expired)
    and the tip may be rebuilt.
- A Horizon fallback for classic payments uses `GET /transactions/{hash}`.
- **Never trust "success" from submission alone.** The UI shows "Sending…" until the tip is
  `confirmed`. The optimistic deduction is kept during `submitted` and `unknown`, and is
  rolled back only on a definitive `failed`, `cancelled` or expired.
- On app start, a reconciler resumes every intent that is `submitted` or `unknown`.

#### Receipts
- A `TipReceipt` is derived from a confirmed transaction: `{ txHash, ledger, closedAt, from,
  to, asset, amount, memo, network }`. It is shown in the UI and linked to a block explorer.
- **Verification:** `verifyReceipt(receipt)` re-fetches the transaction from RPC or Horizon and
  checks that it succeeded and that the decoded operation's destination, amount and asset all
  match. A contract tip is also checked against the emitted `tip` event. This guards against
  a tampered local receipt.
- Optional: POST the receipt to the existing web API so it appears on the creator's
  dashboard. The server **re-verifies on-chain** and never trusts the amount or ids the
  client sends.

#### Events
`tip.created`, `tip.signed`, `tip.submitted`, `tip.confirmed`, `tip.failed{code}`,
`tip.cancelled`, `tip.reconciled` go to `telemetryCollector`, with no secrets and the
addresses truncated.

#### Failure modes
| Failure | Behaviour |
|---|---|
| Insufficient balance (simulation fails) | `failed` before submission, with a clear message, and the balance is rolled back |
| User cancels biometric or wallet prompt | `cancelled`, rolled back |
| Network timeout after submit | `unknown`. Show "Checking…". Resubmit the **same** XDR or poll. Never build a new transaction until `maxTime` has passed. |
| App killed mid-flow | The persisted intent is resumed by the reconciler on next launch |
| Double tap | The same intent id. The second tap is ignored while one is active (the existing `submitting` ref and `TipLock` stay as UI guards). |
| `tx_bad_seq` | Definitive failure of *that* transaction. Safe to rebuild with a fresh sequence number. |
| Contract not configured | Fails before submission (unchanged) |

### Files Involved
- [mobile/src/tipping/TippingService.ts](../../mobile/src/tipping/TippingService.ts) (state manager wiring; remove the fake XDR)
- `mobile/src/tipping/{TipTransactionBuilder,TipConfirmer,TipReconciler,receipts,amount}.ts` (new)
- [mobile/src/services/MultiAccountService.ts](../../mobile/src/services/MultiAccountService.ts) / [WalletConnectService.ts](../../mobile/src/services/WalletConnectService.ts) (`WalletSigner` implementations; real signing depends on #1787)
- [mobile/src/database/schema.ts](../../mobile/src/database/schema.ts) (`tip_intents` table + migration)
- [mobile/package.json](../../mobile/package.json) (`@stellar/stellar-sdk`)
- [docs/PAYMENTS.md](../PAYMENTS.md), [mobile/README.md](../../mobile/README.md) (tipping section, env vars)

### Test plan (Jest; mocked RPC and signer)
- **Main path:** build, sign, `PENDING`, then `getTransaction` `SUCCESS`. The tip is
  `confirmed`, the receipt matches, and `verifyReceipt` passes.
- **Acceptance: retry doesn't double-tip:**
  - A timeout after `sendTransaction` followed by a retry calls `sendTransaction` with the
    **identical** signed XDR, and `signTransaction` is called **once**.
  - The app restarts with an intent in `submitted`. The reconciler polls and does not
    rebuild.
  - The RPC returns `DUPLICATE` on resubmit, which is treated as `submitted`, not as an error.
- **Edge cases:**
  - `getTransaction` → `FAILED` leads to `failed` and a balance rollback.
  - `NOT_FOUND` past `maxTime` leads to `failed` (expired), and only then is a rebuild
    allowed.
  - The user cancels signing, which leads to `cancelled` and no RPC call.
  - Amount `"0.1"` gives exactly `1000000n`. `"0.00000001"` is rejected (8 decimals for a
    7-decimal asset), and so are `"-1"`, `"0"` and `"abc"`.
- **Negative:** `verifyReceipt` fails when the on-chain destination or amount differs from
  the receipt.
- **Regressions:**
  - A `PENDING` response alone no longer produces `status: 'success'`.
  - The payload sent to `sendTransaction` is base64 XDR that decodes as a
    `TransactionEnvelope` (today it is JSON).
- **Benchmark:** the number of RPC calls per confirmed tip (target ≤ 6 on testnet), noted in
  the PR.

### Action Items
- [ ] Design note in PR (state machine + idempotency rule above)
- [ ] Real XDR building via `@stellar/stellar-sdk` with `timeBounds`
- [ ] `WalletSigner` abstraction for local keys and WalletConnect (coordinate with #1787)
- [ ] Persisted `TipIntent` + confirmer + reconciler
- [ ] Decimal-safe amount parsing
- [ ] Receipts + on-chain verification
- [ ] Update `docs/PAYMENTS.md` and `mobile/README.md`
- [ ] Tests above. `pnpm typecheck && pnpm lint && pnpm test` green.

### Dependencies / deferred
- **Depends on #1787** for real local signing. Until it lands, ship with the WalletConnect
  signer only, behind a flag.
- Server-side receipt ingestion with on-chain re-verification can be a follow-up PR
- Fee-bump / sponsored fees for users with no XLM: out of scope
