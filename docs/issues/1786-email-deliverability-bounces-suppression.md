# 📌 Issue Preview: Email deliverability (SPF/DKIM/DMARC), bounce handling and suppression lists

**Labels:** `backend`, `email`, `deliverability`, `hard`

**Issue:** #1786 · **Size:** L · **Pinned commit:** `dd8420b`

---

### Description
Bounce and complaint webhooks arrive, but nothing acts on them in a way that protects the
sending domain. There is no suppression list that a sender checks before sending, no
DMARC/SPF/DKIM setup is documented, and nothing rate-limits outbound mail. If we keep mailing
hard-bounced addresses and people who filed complaints, mailbox providers will lower the
domain's reputation and our transactional mail (password resets, verification) will start
going to spam.

### Current Behavior (as found in code)

| Location | What it does today | Problem |
|---|---|---|
| [bounce/route.ts](../../app/api/webhooks/email/bounce/route.ts#L12-L41) | HMAC signature check with a 5-minute window and timing-safe compare | Good. Keep it. |
| [bounce/route.ts](../../app/api/webhooks/email/bounce/route.ts#L59-L64) | Finds the `User` by email and does `continue` if none is found | Bounces for addresses that don't belong to a user (invites, typos, changed emails) are dropped. Nothing gets suppressed. |
| [bounce/route.ts](../../app/api/webhooks/email/bounce/route.ts#L66-L141) | Sets `User.emailBounced = true` for hard bounces, 3 soft bounces, *and* complaints | Bounces and complaints set the same flag, and nothing ever clears it. The flag lives on the user, not the address, so when a user changes their email the new address inherits the suppression. |
| [bounce/route.ts](../../app/api/webhooks/email/bounce/route.ts#L85-L101) | Soft-bounce count is read from the most recent `templateKey: 'bounce'` log row | A hard-bounce row written in between resets the count to 1. The count never decays over time. Two webhooks processed at the same moment can both read N and write N+1 (a race). |
| bounce/route.ts (whole file) | No dedupe on `message_id`, no zod | Providers retry deliveries, so a retried event is counted twice. A malformed body throws inside `JSON.parse`, returns 500, and the provider retries it forever. |
| [schema.prisma](../../prisma/schema.prisma#L87) `User.emailBounced` | Read only by [admin/email-stats](../../app/api/admin/email-stats/route.ts#L56) | **No sender checks it.** |
| [digest-service.ts](../../server/services/notifications/digest-service.ts#L8-L16) | Queues `EmailDeliveryLog` rows with status `QUEUED` | The comment in this file says outright that there is no outbound sender in the repo. Any suppression check has to sit at the queue/send boundary that a future sender will use. |
| [lib/email/templates](../../lib/email/templates) | 5 `.hbs` templates | No tests. No plain-text alternatives. Not every template includes `List-Unsubscribe` / `List-Unsubscribe-Post` (RFC 8058) headers, which Gmail and Yahoo require for bulk senders. |
| [lib/rate-limit.ts](../../lib/rate-limit.ts) | In-memory limiter that only covers exports | Nothing limits outbound email per recipient or overall. |

### Design note

#### Data model (Prisma migration)
```prisma
model EmailSuppression {
  id          String              @id @default(cuid())
  email       String              @unique          // normalised: trim + lowercase
  reason      SuppressionReason                    // HARD_BOUNCE | SOFT_BOUNCE_THRESHOLD | COMPLAINT | MANUAL | UNSUBSCRIBE_ALL
  source      String                               // 'webhook:<provider>' | 'admin:<userId>'
  scope       SuppressionScope    @default(ALL)    // ALL | NON_TRANSACTIONAL
  createdAt   DateTime            @default(now())
  expiresAt   DateTime?                            // null = permanent
  lastEventId String?
}

model EmailEvent {                                  // raw webhook events, dedupe + audit
  id                String   @id @default(cuid())
  providerEventId   String   @unique                // dedupe key
  type              String                          // bounce | complaint | delivered | ...
  bounceType        String?
  email             String
  providerMessageId String?
  payload           Json
  receivedAt        DateTime @default(now())
  @@index([email, type, receivedAt])
}
```
`User.emailBounced` becomes derived. Keep the column for one release and fill it from
`EmailSuppression`, then remove it. Admin stats should read the suppression table instead.

#### Suppression policy (`lib/email/suppression.ts`)
| Event | Action |
|---|---|
| Hard or permanent bounce | `HARD_BOUNCE`, scope `ALL`, permanent |
| Soft bounce | Record an `EmailEvent`. If there are **3 or more within 7 days**, add `SOFT_BOUNCE_THRESHOLD` with scope `ALL` and `expiresAt` = +30 days. The count is a `COUNT(*)` over `EmailEvent`, so it can't race. |
| Complaint or spam | `COMPLAINT`, scope `NON_TRANSACTIONAL`, permanent. Password resets and verification mail still go out. |
| Unsubscribe "all" ([unsubscribe route](../../app/api/email/unsubscribe/route.ts)) | `UNSUBSCRIBE_ALL`, scope `NON_TRANSACTIONAL` |
| User changes email | The old address's rows stay. The new address starts clean. |

API:
- `isSuppressed(email, category): Promise<{ suppressed: boolean; reason? }>`
- `suppress(...)`
- `unsuppress(email, actor)`, admin only, audited.

Every state change emits `email.suppressed` or `email.unsuppressed` through the existing
`logger` and, where it exists, the domain event bus.

#### Webhook route (thin) + service
- Validate with zod at the boundary: a discriminated union on `type`, a normalised email, and
  a required `event_id` (or a hash of `message_id + type + timestamp` when the provider
  doesn't send one).
- Return 400 for an invalid shape. Never return 500 for bad input, because the provider would
  retry it forever.
- Business logic lives in `server/services/email/webhook-service.ts`, inside one
  `prisma.$transaction`: insert the `EmailEvent` (on a unique violation, the event is a
  duplicate, so return 200 and do nothing), then apply the policy.
- Return 200 for events with no matching user. Suppression is keyed by address, not by user.

#### Send boundary
- `lib/email/send.ts` `enqueueEmail({ to, templateKey, category, ... })` becomes the **only**
  way to create an `EmailDeliveryLog` row. `digest-service` is changed to call it.
- It checks `isSuppressed`. If suppressed, it writes the row with `status: SKIPPED` and
  `errorMessage: 'suppressed:<reason>'`.
- It applies rate limits:
  - per recipient: 10 per hour, and 1 per minute for the same template;
  - global: a configurable per-minute cap.
  
  Both use the Redis-backed counter in [lib/storage/redis.ts](../../lib/storage/redis.ts),
  with the in-memory store as a dev fallback. A send over the limit gets `status: DEFERRED`,
  not dropped.
- Transactional categories (`reset-password`, `verify-email`) skip suppressions with scope
  `NON_TRANSACTIONAL` but never skip `HARD_BOUNCE`.

#### DMARC / SPF / DKIM
- Code can't fix these. They are DNS work, so write a `docs/EMAIL_DELIVERABILITY.md` runbook:
  - SPF record that includes the provider;
  - 2048-bit DKIM with a rotation schedule;
  - DMARC rollout `p=none` → `quarantine` → `reject`, with `rua=` aggregate reports;
  - aligned `From`/Return-Path.
- DMARC aggregate reports: send `rua` to a mailbox or a third-party parser for now. In-app
  report parsing is deferred, with a linked follow-up issue.
- Add a startup and CI check script `scripts/check-email-dns.ts` that resolves the TXT records
  and warns when SPF, DKIM or DMARC are missing. It is optional in CI, because CI has no
  network access to production DNS.

#### Templates
- Render tests for every `.hbs`: required variables present, no unrendered `{{`, a plain-text
  part generated, and an unsubscribe link plus `List-Unsubscribe` headers on everything that
  isn't transactional.
- Snapshot the rendered HTML.

#### Failure modes
| Failure | Behaviour |
|---|---|
| Bad signature or stale timestamp | 401 (unchanged) |
| Malformed JSON or schema mismatch | 400, logged, not retried |
| Duplicate event | 200, no-op |
| DB down | 500, so the provider retries. That is safe because event inserts are idempotent. |
| Redis down for the rate limiter | Fail **open** for transactional mail and fail **closed** (defer) for the rest. Alert either way. |
| Suppression lookup fails at send time | Fail closed (skip the send, then retry). |

### Files Involved
- [app/api/webhooks/email/bounce/route.ts](../../app/api/webhooks/email/bounce/route.ts) (thin route + zod)
- `server/services/email/webhook-service.ts` (new)
- `lib/email/suppression.ts`, `lib/email/send.ts`, `lib/email/render.ts` (new)
- [lib/email/templates/](../../lib/email/templates)
- [server/services/notifications/digest-service.ts](../../server/services/notifications/digest-service.ts) (route through `enqueueEmail`)
- [app/api/email/unsubscribe/route.ts](../../app/api/email/unsubscribe/route.ts) ("all" also writes a suppression)
- [app/api/admin/email-stats/route.ts](../../app/api/admin/email-stats/route.ts)
- [prisma/schema.prisma](../../prisma/schema.prisma) + migration
- `docs/EMAIL_DELIVERABILITY.md` (new), `.env.example` (`EMAIL_WEBHOOK_SECRET`, rate-limit vars)

### Test plan
- **Main path:** a hard-bounce webhook leads to `isSuppressed(addr, 'bounty_alerts')` being
  true, and `enqueueEmail` writes a `SKIPPED` row.
- **Edge cases:**
  - A soft bounce ×2 doesn't suppress. A third bounce within 7 days does. A third bounce on
    day 8 doesn't.
  - The same `event_id` delivered twice produces one `EmailEvent` and no double count.
  - A bounce for an address with no `User` is still suppressed.
  - A complaint suppresses marketing but still allows `reset-password`.
  - Mixed case or whitespace in the address is normalised to the same suppression row.
- **Negative (privileged):** bad signature returns 401. An expired timestamp returns 401.
  A non-admin calling `unsuppress` gets 403.
- **Regressions:**
  - A hard-bounce row between soft bounces no longer resets the soft count.
  - A malformed body returns 400, not 500.
- **Rate limiting:** the 11th email to one recipient within an hour is `DEFERRED`.
- **Templates:** a render and headers test for each template.
- **Benchmark:** `isSuppressed` is a single indexed lookup. Record its p95 in the PR.

### Action Items
- [ ] Design note in the PR
- [ ] `EmailSuppression` and `EmailEvent` models + migration (backfill from `User.emailBounced`)
- [ ] zod-validated, idempotent webhook → suppression service
- [ ] `enqueueEmail` send boundary with suppression check + rate limiting
- [ ] Template render tests + `List-Unsubscribe` headers
- [ ] `docs/EMAIL_DELIVERABILITY.md` (SPF/DKIM/DMARC runbook) + DNS check script
- [ ] Admin stats read from suppression table
- [ ] Tests above. `pnpm typecheck && pnpm lint && pnpm test` green.

### Deferred / out of scope
- An actual outbound provider integration (there isn't one in the repo today, per
  `digest-service.ts`)
- In-app DMARC aggregate report parsing
- Admin UI for viewing and lifting suppressions (an API-only `unsuppress` is in scope)
