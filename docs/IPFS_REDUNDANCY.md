# IPFS Multi-Provider Redundancy & Pin Health Monitoring (Issue #1769)

## Design Note

### Overview
Single-provider IPFS pinning creates a single point of failure: if one pinning provider drops content or suffers an outage, portfolio assets become unavailable. This design introduces concurrent multi-provider pinning (`>= 2` providers), cryptographic CID verification on retrieval, gateway racing with timeouts and EWMA health ranking, and automated periodic pin health sweeps that re-pin dropped content.

---

### Data Model

Additive Prisma table `IpfsPinReplica` (migration `20261121000000_ipfs_pin_health_and_media_pipeline`):

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `TEXT` (cuid) | Primary key |
| `cid` | `TEXT` | IPFS Content Identifier |
| `provider` | `TEXT` | Provider name (`pinata`, `filebase`, `kubo`, `psa`) |
| `providerPinId` | `TEXT?` | Optional provider-assigned pin/request ID |
| `status` | `TEXT` | `PINNED`, `DEGRADED`, `FAILED`, or `REPINNING` |
| `lastCheckedAt` | `TIMESTAMP?` | Timestamp of last health probe |
| `lastHealthyAt` | `TIMESTAMP?` | Timestamp of last confirmed healthy probe |
| `consecutiveFailures` | `INT` | Consecutive failed health checks |
| `lastLatencyMs` | `INT?` | Last observed probe/pin latency (ms) |
| `lastError` | `TEXT?` | Last failure message for diagnostics |

Unique constraint on `(cid, provider)` with indexes on `cid`, `status`, and `lastCheckedAt`.

---

### Architecture & API Surface

1. **Multi-Provider Pinning (`lib/ipfs/pinner.ts`)**
   - Supported providers: `PinataPinner`, `FilebasePinner`, `PinningServiceApiPinner` (IPFS PSA spec), and `KuboPinner`.
   - `getPinners()` discovers all configured providers from environment variables.
   - `MultiProviderPinner.pin()` pins concurrently across all configured providers with `Promise.all` and per-provider timeouts, reporting `succeededProviders`, `failedProviders`, `redundancyMet`, and `degraded`.
   - `POST /api/ipfs/pin`: Validates session, rate quota, file size, magic bytes, and SHA-256; pins redundantly across configured providers, persists `PinnedFile` and `IpfsPinReplica` rows, logs an audit entry, and revalidates the `ipfs-files` RSC cache tag.

2. **Gateway Racing & Health Ranking (`lib/ipfs/gateways.ts`)**
   - `GatewayHealthTracker` tracks successes, consecutive failures, temporary cooldown windows (60s after 2 consecutive failures), and EWMA latency per gateway.
   - `raceGateways(cid, options)` validates CID syntax, ranks healthy gateways, fires concurrent requests with per-gateway timeouts (`IPFS_GATEWAY_TIMEOUT_MS`, default 8000ms), verifies content integrity, and immediately aborts losing requests once the fastest verified gateway responds.

3. **Cryptographic CID Verification (`lib/ipfs/cid-verify.ts`)**
   - Rejects malformed and path-traversal CID strings before making network requests (`isValidCid`).
   - Verifies retrieved bytes against CIDv1 raw (`bafkrei...`, codec `0x55`, sha2-256), single-block dag-pb (`bafybei...` / `Qm...`), and deterministic local dev CIDs (`verifyCidContent`).

4. **Periodic Health Checks & Auto-Repinning (`lib/ipfs/health-monitor.ts`)**
   - `checkAndRepairPin()` checks gateway retrievability (with CID + SHA-256 verification) and provider-level pin status (`hasPin`).
   - Whenever a provider has dropped a pin, verified bytes from surviving replicas/gateways are automatically re-pinned to restore redundancy.
   - `POST /api/admin/cron/ipfs-health`: Constant-time `X-Cron-Secret` authenticated sweep endpoint with Zod-validated options (`limit`, `targetRedundancy`, `timeoutMs`).
   - `GET /api/ipfs/health`: Session-authenticated endpoint returning configured provider status, gateway health snapshots, and replica states.
   - `server/jobs/ipfs-pin-health.ts`: Standalone CLI/cron runner.

---

### Failure Modes & Mitigations

| Failure Mode | Mitigation |
| :--- | :--- |
| One pinning provider is down during upload | Upload succeeds in `degraded` mode on surviving provider(s) unless `IPFS_REQUIRE_QUORUM=true`; failed replica is recorded as `FAILED` and auto-repaired by the next health sweep. |
| Provider silently drops a previously pinned asset | Periodic sweep detects missing pin via `hasPin()`, fetches CID-verified bytes from surviving replicas/gateways, and re-pins automatically. |
| Poisoned/malicious IPFS gateway serves tampered bytes | `raceGateways()` rejects responses failing CID or SHA-256 verification, records a gateway failure, and promotes the fastest honest peer. |
| Hung gateway stalls fetch | Per-gateway `AbortController` timeout cancels slow gateways without blocking the race. |
| Crafted CID attempts path traversal / SSRF | `isValidCid()` rejects slashes, `..`, query strings, and non-CID inputs at the boundary. |
