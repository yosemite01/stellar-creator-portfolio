# Mobile telemetry with privacy controls

**Issue:** #1791 · **Area:** mobile · **Status:** Design (not yet implemented)

## Summary

Mobile telemetry must not collect anything until the user has consented, must strip personal data before events leave the device, must sample high-volume events, and must let the user opt out at any time.

## Why this matters

- **Regulation.** GDPR and the ePrivacy Directive (EU/UK) and CCPA/CPRA (California) require consent or an opt-out, data minimisation, and honouring withdrawal.
- **App store policy.** Apple's App Tracking Transparency and privacy nutrition labels, and Google Play's Data safety form, need an accurate declaration of what we collect. If what we collect doesn't match the declaration, the app can be rejected or removed.

## Current state

The issue points to `mobile/src/telemetry` at commit `dd8420b`. On `main` (as of `a3edbdb6`) there is no `mobile/` directory, and `dd8420b` isn't in this repository's history. This document is the spec the module should be built against. When the module lands, the "Implementation" section should be updated with real file paths.

## Design

### Module layout

```
mobile/src/telemetry/
  index.ts          # public API: init(), track(), setConsent(), optOut()
  consent.ts        # consent state machine + persistence
  scrubber.ts       # PII removal applied to every event
  sampler.ts        # deterministic per-event-type sampling
  transport.ts      # batching, retry, offline queue
  schema.ts         # allow-listed event names and property types
  __tests__/
```

Feature code only calls `track(name, props)`. Nothing else may import a vendor SDK directly. A lint rule (`no-restricted-imports`) enforces this.

### 1. Consent flow

| State | Collection | Network |
|---|---|---|
| `unknown` (first launch) | None. Events are dropped, **not** buffered | None |
| `granted` | Full allow-listed schema | Yes |
| `essential_only` | Crash reports and app version only | Yes |
| `denied` | None | None |

- Show the consent sheet on first launch, before `init()` sends anything. Accept, Essential only and Decline get equal visual weight (no dark patterns).
- On iOS, request ATT only if a cross-app identifier is ever needed. The default design uses no IDFA/AAID, so ATT is not prompted.
- Persist `{ state, version, decidedAt }` in secure storage (Keychain / EncryptedSharedPreferences).
- Increment `CONSENT_VERSION` whenever the collected data categories change. A stored version below the current one resets the state to `unknown` and asks again.
- Mirror the consent state to the backend (`PUT /api/v1/me/telemetry-consent`) so server-side analytics joins honour it.

### 2. Scrubbing

Every event goes through `scrub()` before it is queued. The scrubber is **allow-list first**:

1. Drop any event name not in `schema.ts`.
2. Drop any property that is not declared for that event, or whose type does not match.
3. Run a regex pass over the remaining string values and replace matches with `[redacted]`:
   email, phone (E.164 and local formats), Stellar public keys (`G[A-Z2-7]{55}`) and secret seeds (`S[A-Z2-7]{55}`), IPv4/IPv6, JWTs, credit-card-like digit runs (Luhn-checked), and URLs with query strings (keep only the path).
4. Replace user IDs with a per-install random ID (`installId`, a UUIDv4 regenerated on opt-out). Never send the account ID.
5. Coarsen device data: OS major version, device class (phone/tablet), locale language only, timezone offset rounded to the hour.
6. Do not send the IP address. Configure the collector to drop `X-Forwarded-For` and not log it.

### 3. Sampling

- Each event type in `schema.ts` has a sample rate, for example `screen_view: 0.1`, `api_error: 1.0`, `crash: 1.0`.
- Sampling is deterministic: `hash(installId + eventName) < rate`, so a given install is consistently in or out for each event type and funnels stay coherent.
- Rates can be overridden by remote config, bounded to `[0, 1]`. They can only go **down** from the shipped default unless a new app version raises the default.
- Each event carries `sample_rate` so dashboards can re-weight counts.

### 4. Opt-out

- **Settings → Privacy → Share usage data** toggle, reachable in at most two taps.
- Opting out: set state to `denied`, flush-drop the offline queue (don't send it), rotate `installId`, and call `DELETE /api/v1/me/telemetry` to request deletion of server-side events linked to the old install ID within 30 days.
- Honour the OS-level signals: iOS "Allow Apps to Request to Track" off, and Android "Delete advertising ID".
- Opting back in returns to `granted` with the new `installId`. The old data stays deleted.

## Test plan

| Test | Type |
|---|---|
| No network calls happen in `unknown` and `denied` states (mock transport, assert zero sends) | Unit |
| Scrubber removes every PII pattern in a fixture corpus; unknown props/events are dropped | Unit (table-driven) |
| Property-based test: random strings containing embedded emails/keys never survive `scrub()` | Unit (fast-check) |
| Sampler is deterministic per install and its distribution is within ±2% of the rate over 100k IDs | Unit |
| Opt-out drops the queue, rotates the ID and calls the deletion endpoint | Unit |
| Consent version bump re-prompts | Unit |
| First-launch E2E: decline → use the app → proxy shows zero telemetry requests | E2E (Detox/Maestro) |

## Docs to update

- `README.md`: a short "Privacy & telemetry" section linking here.
- App Store privacy label and Play Data safety form: list exactly the categories in `schema.ts`.
- Privacy policy: data categories, retention (90 days raw, 13 months aggregated) and the deletion process.

## Acceptance criteria

- [ ] Nothing is sent before consent; this is verified by an E2E network assertion.
- [ ] All events pass through the scrubber; the PII fixture suite passes.
- [ ] Per-event sampling is configurable and recorded on each event.
- [ ] Opt-out is in Settings, takes effect immediately and triggers server-side deletion.
- [ ] Store declarations match `schema.ts`.
