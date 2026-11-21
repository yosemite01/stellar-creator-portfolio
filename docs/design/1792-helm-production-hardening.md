# Helm chart production hardening

**Issue:** #1792 · **Area:** infrastructure / Kubernetes · **Status:** Design (not yet implemented)

## Summary

Add PodDisruptionBudgets, tuned HorizontalPodAutoscalers, restrictive pod/container `securityContext` and default-deny NetworkPolicies to every deployment in the Helm chart. Validate the rendered manifests in CI with kubeconform and kube-score.

## Why this matters

- **Resilience.** Without PDBs, a node drain or cluster upgrade can evict every replica at once. Without HPAs, traffic spikes cause outages and quiet periods waste money.
- **Blast radius.** Root containers with writable filesystems and full Linux capabilities make container escape and persistence easier. A flat pod network lets one compromised pod reach every other service and the database.

## Current state

The issue points to `helm/values.yaml` (11 lines), `helm/charts` and `infrastructure/k8s` at commit `dd8420b`. On `main` (as of `a3edbdb6`) none of these paths exist, and `dd8420b` isn't in this repository's history. This document specifies the target chart. Deployable components today are the Next.js web app and the Rust services in `backend/services/` (`api`, `stellar`). Redis and Postgres are external dependencies.

## Design

### Values structure

Each component gets the same block, with defaults set in the parent chart:

```yaml
# helm/values.yaml
global:
  podSecurity:
    runAsNonRoot: true
    runAsUser: 10001
    runAsGroup: 10001
    fsGroup: 10001
    seccompProfile: { type: RuntimeDefault }
  containerSecurity:
    allowPrivilegeEscalation: false
    readOnlyRootFilesystem: true
    privileged: false
    capabilities: { drop: ["ALL"] }
  networkPolicy:
    enabled: true
    ingressControllerNamespace: ingress-nginx

web:
  replicaCount: 3
  resources:
    requests: { cpu: 250m, memory: 384Mi }
    limits:   { memory: 768Mi }        # no CPU limit to avoid throttling
  pdb: { enabled: true, minAvailable: 2 }
  hpa:
    enabled: true
    minReplicas: 3
    maxReplicas: 20
    targetCPUUtilizationPercentage: 65
    targetMemoryUtilizationPercentage: 75
    behavior:
      scaleUp:   { stabilizationWindowSeconds: 0,   policies: [{ type: Percent, value: 100, periodSeconds: 30 }] }
      scaleDown: { stabilizationWindowSeconds: 300, policies: [{ type: Percent, value: 20,  periodSeconds: 60 }] }
  writableDirs: ["/tmp", "/app/.next/cache"]

api:
  replicaCount: 3
  pdb: { enabled: true, maxUnavailable: 1 }
  hpa: { enabled: true, minReplicas: 3, maxReplicas: 15, targetCPUUtilizationPercentage: 70 }
  writableDirs: ["/tmp"]

stellar:
  replicaCount: 2
  pdb: { enabled: true, minAvailable: 1 }
  hpa: { enabled: true, minReplicas: 2, maxReplicas: 6, targetCPUUtilizationPercentage: 70 }
  writableDirs: ["/tmp"]
```

### 1. PDBs and HPAs per deployment

- Shared templates `templates/_pdb.tpl` and `templates/_hpa.tpl` are included by each component. A PDB is rendered only when `replicaCount > 1` or the HPA is enabled, so a single-replica dev install can still drain.
- PDBs use `minAvailable` for latency-critical web and `maxUnavailable: 1` for the API, so rolling node upgrades never block.
- HPAs use `autoscaling/v2`. When the HPA is enabled, `replicas` is omitted from the Deployment so Helm upgrades don't fight the autoscaler.
- The scale-down stabilisation window (300 s) prevents flapping. Scale-up is aggressive.
- Requests are required on every container (HPA utilisation is computed against requests). The CI check below enforces this.
- Add `topologySpreadConstraints` across `topology.kubernetes.io/zone` and `kubernetes.io/hostname` so a PDB isn't defeated by co-located replicas.

### 2. Non-root, read-only rootfs, dropped capabilities

- The pod and container `securityContext` values from `global` are applied to every pod and can be overridden per component, but only toward stricter settings (documented, and checked in review).
- Images: Dockerfiles create UID/GID `10001` and `USER 10001`. The Rust services use a distroless/static base. Next.js uses `node:*-slim` running as non-root.
- Read-only rootfs: each `writableDirs` entry is mounted as an `emptyDir` (with `medium: Memory` and `sizeLimit` for `/tmp`).
- `automountServiceAccountToken: false` unless a component needs API access. Each component gets its own ServiceAccount.
- Label the namespace `pod-security.kubernetes.io/enforce: restricted` so the cluster rejects regressions.

### 3. NetworkPolicies default-deny

```
templates/networkpolicy-default-deny.yaml   # podSelector: {}, policyTypes: [Ingress, Egress]
templates/networkpolicy-dns.yaml            # egress UDP/TCP 53 to kube-dns
templates/networkpolicy-<component>.yaml    # explicit allows
```

| From → To | Port | Allowed |
|---|---|---|
| Ingress controller → web | 3000 | ✅ |
| Ingress controller → api | 8080 | ✅ |
| web → api | 8080 | ✅ |
| api → stellar | 8080 | ✅ |
| api, stellar → Postgres (CIDR or namespace selector) | 5432 | ✅ |
| api, web → Redis | 6379 | ✅ |
| stellar → Horizon / Soroban RPC (egress CIDR or egress gateway) | 443 | ✅ |
| Prometheus namespace → all `/metrics` | metrics port | ✅ |
| Everything else | — | ❌ |

External egress destinations are listed in `values.yaml` (`egress.allowedCidrs`), not hard-coded. For FQDN-based egress, document Cilium `CiliumNetworkPolicy` as an optional add-on.

### 4. kube-score / kubeconform in CI

New workflow `.github/workflows/helm-lint.yml`, triggered on changes under `helm/**` or `infrastructure/k8s/**`:

```yaml
jobs:
  helm:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: azure/setup-helm@v4
      - run: helm lint helm --strict
      - run: |
          for f in helm/ci/*.yaml; do
            helm template t helm -f "$f" > "rendered-$(basename "$f")"
          done
      - name: kubeconform
        run: |
          kubeconform -strict -summary -kubernetes-version 1.30.0 \
            -schema-location default \
            -schema-location 'https://raw.githubusercontent.com/datreeio/CRDs-catalog/main/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json' \
            rendered-*.yaml
      - name: kube-score
        run: kube-score score rendered-*.yaml --output-format ci --exit-one-on-warning
      - name: helm unittest
        run: helm plugin install https://github.com/helm-unittest/helm-unittest && helm unittest helm
```

Pin tool versions in the workflow. Any kube-score check that has to be ignored is listed in `.kube-score.yml` with a justification comment.

`helm/ci/` holds value files for the main scenarios: `default.yaml`, `dev-single-replica.yaml` and `hpa-disabled.yaml`.

## Test plan

`helm-unittest` suites in `helm/tests/`:

| Assertion | File |
|---|---|
| Every Deployment has `runAsNonRoot`, `readOnlyRootFilesystem`, `capabilities.drop: [ALL]`, `allowPrivilegeEscalation: false`, `seccompProfile` | `security_test.yaml` |
| Every Deployment has CPU/memory requests and a memory limit | `resources_test.yaml` |
| PDB rendered iff replicas > 1 or HPA enabled; HPA present ⇒ Deployment has no `replicas` | `pdb_hpa_test.yaml` |
| Default-deny policy exists and selects all pods; each allow policy matches the table above | `networkpolicy_test.yaml` |
| `writableDirs` become `emptyDir` mounts | `volumes_test.yaml` |

Manual/cluster verification (kind in CI is optional): `kubectl exec` into a pod and confirm `id` returns 10001 and `touch /x` fails. A `curl` from a throwaway pod to `api:8080` is blocked, and from `web` it is allowed.

## Docs to update

- `helm/README.md`: values reference, how to add a writable dir, how to open a new network path, and the rollout notes below.
- `CONTRIBUTING.md`: running `helm unittest` and kubeconform locally.

## Rollout notes

1. Ship the image changes (non-root UID) first and verify them in staging.
2. Enable the securityContext, then NetworkPolicies with `networkPolicy.enabled: true` in staging. Watch for denied connections (CNI flow logs) for 48 h.
3. Enable PDB/HPA. Confirm that `metrics-server` is installed.
4. Promote to production.

## Acceptance criteria

- [ ] Every deployment has a PDB and an HPA (configurable, enabled by default).
- [ ] All pods run non-root with a read-only rootfs and ALL capabilities dropped, and pass the PSS `restricted` profile.
- [ ] A default-deny NetworkPolicy is in place, with explicit allows only.
- [ ] CI fails on kubeconform errors or kube-score warnings.
