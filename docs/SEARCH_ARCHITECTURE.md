# Search Architecture Decision Record: Postgres vs Elasticsearch (#1763)

## Decision

The platform has selected **PostgreSQL** (with `tsvector`, `GIN` indexing, `pg_trgm` fuzzy matching, and vector extensions) as the unified search engine and completely removed `@elastic/elasticsearch`.

## Comparison & Rationale

| Dimension | Elasticsearch | PostgreSQL (Chosen) |
|---|---|---|
| **Operational Overhead** | Requires separate cluster, JVM tuning, node monitoring, and upgrades. | Reuses existing Postgres infrastructure (RDS/Aurora/Docker). |
| **Data Consistency** | Eventual consistency; requires change data capture (CDC) or double-writes. | Immediate consistency; ACID transactions with main application state. |
| **Failure Modes** | Dual-failure risks: out-of-sync indexes, network splits, cluster RED states. | Single source of truth. Connection pooling managed by Prisma/PgBouncer. |
| **Typo & Semantic Search** | BM25 + dense vector knn. | `pg_trgm` similarity for fuzzy matching, tsvector rank for full-text, and embeddings. |
| **Costs** | Additional cluster hosting and memory overhead. | Zero incremental hosting cost. |

## Implementation

- **Lexical & Fuzzy Search**: Handled via `tsvector` with `to_tsquery` English stemming and `similarity(displayName, query) > 0.3` for typo tolerance.
- **Bounty Materialized Views**: `bounty_search_view` refreshed asynchronously on domain mutations.
- **Unified Query Routing**: `hybridSearch` directly leverages Postgres full-text search with identical result types (`SearchResult[]`), score breakdown, and filters.
