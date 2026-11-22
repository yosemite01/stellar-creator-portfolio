# Creators Directory DB-Backed Listing & Cursor Pagination (Issue #1824)

This document describes the transition of the Creators Directory from static array data (`lib/services/creators-data.ts`) to a scalable, database-backed query architecture with stable cursor pagination under concurrent inserts and multi-level caching.

---

## 1. Overview & Motivation

The creator directory and profile pages previously depended on static in-memory objects (`creators` in `lib/services/creators-data.ts`). This limited scalability, prevented user updates from propagating to the directory, and caused data fragmentation between database records (`CreatorProfile`) and UI components.

With Issue #1824:
1. **Database-Backed**: Directory and detail lookups query PostgreSQL directly via Prisma (`CreatorProfile`, `Project`, `Review`).
2. **Stable Cursor Pagination**: Cursor pagination based on composite keys `(createdAt, id)` guarantees stability under concurrent inserts.
3. **Multi-Attribute Filters**: Fast indexed filtering by discipline, search keyword (case-insensitive across name and bio), skills, rating, and verification.
4. **Caching Layer**: In-memory TTL caching (60s) with cache-control headers (`Cache-Control: public, s-maxage=60, stale-while-revalidate=300`) reduces database load.
5. **Graceful Fallbacks**: Static arrays are marked as deprecated fallback data, ensuring zero regressions for legacy or offline environments.

---

## 2. Stability Under Concurrent Inserts

Offset-based pagination (`OFFSET N LIMIT M`) is vulnerable to shifts when new creators register while a client is browsing subsequent pages (leading to duplicated or skipped items).

Our implementation uses deterministic composite cursor ordering:
```sql
WHERE
  (createdAt < cursor.createdAt)
  OR (createdAt = cursor.createdAt AND id < cursor.id)
ORDER BY
  createdAt DESC, id DESC
LIMIT take + 1;
```

Even if new creators are inserted with newer timestamps (`createdAt > cursor.createdAt`), they are excluded from subsequent pages, ensuring 100% stable pagination without duplicates or gaps.

---

## 3. Endpoints & API

### REST: `GET /api/creators`
- **Query Parameters**:
  - `take` / `limit`: Page size (1..100, default 12).
  - `cursor`: Opaque base64url-encoded composite cursor.
  - `discipline`: Filter by discipline (e.g. `Design`, `Development`).
  - `search`: Case-insensitive search string matching display name or bio.
  - `skills`: Comma-separated list of required skills.
  - `verified`: Boolean flag (`true` / `false`).
  - `minRating`: Minimum rating threshold (0..5).
- **Response**:
  ```json
  {
    "creators": [...],
    "nextCursor": "eyJpZCI6ImMtMSIsImNyZWF0ZWRBdCI6IjIwMjYtMTEtMTZUMTI6MDA6MDAuMDAwWiJ9",
    "hasNextPage": true,
    "total": 42
  }
  ```

### REST: `GET /api/creators/[id]`
- Retrieves detailed creator profile from the database, including related projects and reviews.
- Returns `{ data: creator }` or 404 if not found.

### tRPC: `trpc.creators.list` & `trpc.creators.get`
- Backed by the shared `listCreatorsFromDB` and `getCreatorByIdFromDB` service in `server/services/creators-directory.ts`.
