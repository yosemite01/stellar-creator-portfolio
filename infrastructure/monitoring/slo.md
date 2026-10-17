# Stellar Creator Portfolio — Service Level Objectives (SLOs)

Issue #1598 — defines concrete, measurable SLOs for the Next.js API service
together with Prometheus alert rules that fire when burn rate exceeds budget.

---

## SLO definitions

| SLO | Target | Measurement window | Error budget |
|-----|--------|--------------------|--------------|
| Availability | **99.5 %** success rate | 30-day rolling | 3 h 36 m downtime/month |
| p95 latency | **< 500 ms** | 30-day rolling | 5 % of requests may exceed |
| p99 latency | **< 2 000 ms** | 30-day rolling | 1 % of requests may exceed |

A request is a **success** when the HTTP status is 2xx or 3xx.  5xx responses
count as failures.  4xx responses are excluded from the availability SLO
(client errors are not the service's fault).

---

## Alert runbook

### `StellarApiHighErrorRate` (page)
The API is returning > 0.5 % 5xx errors over the last 5 minutes.

**Investigate:**
1. Check pod logs: `kubectl logs -l app=stellar-api --since=5m`
2. Check DB connectivity: `GET /api/ready`
3. Check Horizon status: <https://status.stellar.org>
4. If DB is down, scale in to zero pods and contact on-call DBA.

### `StellarApiHighLatencyP95` (page)
p95 response time has exceeded 500 ms for 5 consecutive minutes.

**Investigate:**
1. Check Grafana slow-query dashboard.
2. Run `EXPLAIN ANALYZE` on the top slow queries from pg_stat_statements.
3. Check Elasticsearch lag if search endpoints are slow.

### `StellarApiHighLatencyP99` (warn)
p99 response time > 2 s — may indicate queue build-up or memory pressure.

### `StellarApiErrorBudgetBurn1h` (page)
1-hour burn rate > 14× — roughly 2 h of budget consumed in 1 h.  At this
rate the monthly error budget will be exhausted in ~2 days.

### `StellarApiErrorBudgetBurn6h` (warn)
6-hour burn rate > 6× — trending toward budget exhaustion within a week.

---

## Local testing

```bash
# Send synthetic 500s to trigger the alert (requires port-forward)
kubectl port-forward svc/stellar-api 3001:3001
for i in $(seq 1 20); do curl -s http://localhost:3001/api/_test/error; done
# Wait ~2 min then check Prometheus alerts:
# http://localhost:9090/alerts
```

See also `infrastructure/monitoring/prometheus-rules.yaml` for the full
Prometheus rule YAML.
