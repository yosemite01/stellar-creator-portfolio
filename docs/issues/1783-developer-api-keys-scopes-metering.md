# #1783: Developer API: API keys with scopes, usage metering and webhooks

## Context
Key issuance is in good shape:

- [lib/api-keys.ts](../../lib/api-keys.ts) generates `sk_live_<prefix>_<secret>`. It
  stores `sha256(secret)` and a unique public `prefix`, and verifies keys in constant
  time (`verifyApiKey`).
- [app/api/developer/keys/route.ts](../../app/api/developer/keys/route.ts) creates and
  lists keys and returns `rawKey` once. `[id]/route.ts` soft-revokes a key.
- `ApiKey` in [prisma/schema.prisma](../../prisma/schema.prisma) has `scopes String[]`,
  `lastUsedAt`, `expiresAt` and `revokedAt`.

The gaps are in how keys are used:

1. **Key authentication is broken.** [server/graphql/context.ts](../../server/graphql/context.ts)
   reads `x-api-key` and looks it up with `hashApiKey(apiKeyHeader)`, which hashes the
   **whole** raw key. Stored hashes cover only the secret part, so a valid key never
   matches. It should call `parseApiKey`, look the key up by `prefix`, and then call
   `verifyApiKey`. Lookup by prefix also avoids using a hash lookup as an equality oracle.
2. **Scopes are never enforced.** The only scopes are `read-only` and `read-write`, and
   no code checks them. Once item 1 is fixed, a `read-only` key could run mutations.
   The scopes are also too coarse for least privilege.
3. **`lastUsedAt` is never updated, and nothing records usage.** The GraphQL rate
   limiter receives `apiKeyId`, but there are no per-key quotas or usage counters.
4. **No outbound webhooks.** [lib/webhooks/verify-signature.ts](../../lib/webhooks/verify-signature.ts)
   only **verifies inbound** provider webhooks (Resend/Svix, Postmark, SES). Nothing
   lets third parties subscribe to platform events.
5. **No developer dashboard UI** for the existing endpoints.
6. **Expiry is inconsistent.** `generateApiKey` defaults to a 90-day TTL, but the `POST`
   route passes `expiresAt: null` when none is given, which creates a key that never
   expires. Meanwhile `isApiKeyExpired(null)` returns `true`. Pick one rule.

## Why it matters
Third-party integrations should get only the access they need, should be visible and
limitable per key, and should receive events without polling.

## Suggested approach
1. **One authentication path.** Add `authenticateApiKey(header)` to `lib/api-keys.ts`.
   It parses the key, does `findUnique({ where: { prefix } })`, verifies with
   `verifyApiKey`, and rejects keys that are revoked or expired. It returns
   `{ keyId, userId, scopes }`. Accept `Authorization: Bearer sk_live_…` as well as
   `x-api-key`. Use it in GraphQL context and in a `withApiKey(scopes, handler)` wrapper
   for REST routes. Update `lastUsedAt` at most once a minute per key, using Redis, so it
   does not cost a write per request.
2. **Resource-level scopes.** Replace the two scopes with `resource:action` strings, and
   map the old values for existing keys (`read-only` → `*:read`, `read-write` → `*:*`):
   ```
   profile:read  profile:write  bounties:read  bounties:write
   applications:read  applications:write  escrow:read  webhooks:manage
   ```
   - Enforce scopes at each resolver or route with `requireScope(ctx, 'bounties:write')`.
     A request authenticated by key without the scope gets **403**, never a silent
     downgrade.
   - Deny by default: a GraphQL field or route with no declared scope is not reachable
     with an API key at all.
   - A key can never exceed its owner's role permissions
     ([docs/admin-role-permissions.md](../admin-role-permissions.md)).
3. **Usage metering and quotas.**
   - Count requests per key and minute in Redis (`redisIncr`), and flush them into an
     `ApiKeyUsage { keyId, windowStart, requests, errors }` table each hour for the
     dashboard.
   - Enforce quotas per key. Use a per-minute rate limit through the unified limiter
     (#1556), and a monthly quota from the owner's plan. Return `429` with `Retry-After`
     and `X-RateLimit-Limit/Remaining/Reset` headers.
4. **Outbound webhooks.**
   - Schema: `WebhookEndpoint { id, userId, url, secret (encrypted via KMS), events String[], active, createdAt }`
     and `WebhookDelivery { id, endpointId, eventId, eventType, status, attempt, responseCode, nextAttemptAt, lastError }`.
   - Produce events from the transactional outbox (#1759, `recordOutboxEvent` in `lib/db/transaction-manager.ts`), for example
     `bounty.created`, `application.accepted`, `escrow.released` and
     `dispute.opened`.
   - Signing uses `webhook-id`, `webhook-timestamp` and
     `webhook-signature: v1,<base64 HMAC-SHA256(id.timestamp.body)>`, the same scheme
     already verified for Resend/Svix, so integrators can use standard libraries.
     Publish a verification helper in the docs.
   - Retries use exponential backoff (for example 1 m, 5 m, 30 m, 2 h, 6 h, 24 h). Any
     2xx response is success. After the last attempt, the delivery is marked failed, and
     after N failures in a row the endpoint is auto-disabled and the owner is notified.
   - URLs must be `https`, and private, loopback and link-local IPs are blocked after
     DNS resolution to prevent SSRF. Bodies contain IDs and public fields only.
   - Add a "send test event" endpoint and a manual redelivery endpoint.
5. **Developer dashboard** at `/settings/developer`: create a key (scope picker, expiry,
   key shown once with a copy button), list and revoke keys, see usage charts from
   `ApiKeyUsage`, manage webhook endpoints, rotate signing secrets, and see a delivery
   log with redeliver.
6. **Audit** key create/revoke, scope changes, and webhook endpoint create, update,
   delete and rotate in `AuditLog`. Never log raw keys or secrets.

## Docs to update
- A new `docs/developer-api.md`: authentication, the scope list, rate limit headers,
  the webhook event catalogue, the signature verification snippet and the retry
  schedule.
- README: link to the above.

## Test plan
- **Scope enforcement:**
  - A `bounties:read` key can query bounties but gets 403 on `createBounty`.
  - A key with no scopes, or an unknown scope, is rejected when the key is created.
  - A route with no declared scope is not reachable with any key.
  - A legacy `read-only` key behaves as `*:read`.
  - A key whose owner was downgraded loses the permissions the owner lost.
- **Authentication:** a valid key authenticates (regression test for the hash bug),
  while a wrong secret with a valid prefix, a revoked key, an expired key or a
  malformed key all fail. Timing-safe comparison is used.
- **Metering:** N requests give a usage count of N. Exceeding the quota returns 429
  with the headers, and the counter resets with the window.
- **Webhooks:** the signature verifies with the published helper, and a body changed
  by one byte fails. A 500 schedules the next retry at the expected backoff. A 2xx stops
  retries. N failures disable the endpoint. A URL that resolves to `127.0.0.1` or
  `10.0.0.0/8` is refused.
- **Expiry:** a key created without `expiresAt` follows the documented default.

## Acceptance criteria
- [ ] API keys authenticate correctly and are limited to the scopes they were given.
- [ ] Usage is metered per key, and quotas are enforced.
- [ ] Signed outbound webhooks are delivered with retries.
- [ ] CI is green (lint, type-check, tests).
- [ ] No new TODOs without a linked issue.
