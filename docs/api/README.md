# Stellar API — importable collections

| Published | 2026-03-26 |
|-----------|------------|
| Maintainer | favourawaku |

## Contents

| Path | Purpose |
|------|---------|
| [collections/stellar-main-admin.postman_collection.json](./collections/stellar-main-admin.postman_collection.json) | Postman Collection v2.1 — **main + admin** routes, grouped by domain folder: **auth**, **users**, **shop**, **admin** |
| [environments/stellar.local.postman_environment.json](./environments/stellar.local.postman_environment.json) | Example environment (`baseUrl`, `bearerToken`, `sessionToken`) |
| [example.env](./example.env) | Same variables for `.env` / secrets tooling |

Internal-only NextAuth routes (OAuth provider callbacks, etc.) are **not** exported. Use **Get session** and app login for session-backed calls.

## Variables

| Variable | Description |
|----------|-------------|
| `baseUrl` | API origin, e.g. `http://localhost:3000` (no trailing slash) |
| `bearerToken` | `Authorization: Bearer <token>` — for API gateways or future JWT; set in Postman **Bearer Token** auth |
| `sessionToken` | Value of cookie `next-auth.session-token` for routes using `getServerSession` |

## Import (Postman)

1. **Import** → upload `collections/stellar-main-admin.postman_collection.json`.
2. **Import** → upload `environments/stellar.local.postman_environment.json`, select it in the environment dropdown.
3. Set `baseUrl` for your deployment. For authenticated requests, set `sessionToken` after signing in via the web app (copy cookie value) or configure Bearer when your stack issues JWTs.

## One complete integrator flow (collection only)

Goal: prove the collection can drive an end-to-end path without reading source.

1. **Register** — `auth` → `Register` (`POST /api/auth/register`).
2. **List bounties** — `shop` → `List bounties` (`GET /api/bounties?page=1&limit=10`).
3. **Session-backed step** — sign in through the Stellar web UI (credentials), then copy `next-auth.session-token` into environment variable `sessionToken`.
4. **Create review** — `shop` → `Reviews — create` (`POST /api/reviews`) with a real `creatorId` and JSON body.

Steps 1–2 satisfy a minimal read-only integration; step 3–4 exercise authenticated marketplace behavior.

## Admin flow (optional)

With an **ADMIN** session (`sessionToken` from an admin account):

1. `admin` → `Reviews — pending queue`
2. `admin` → `Reviews — moderate` or `Referrals — admin action`
