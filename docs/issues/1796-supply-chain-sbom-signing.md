# 📌 Issue Preview: Supply chain: SBOMs, signed images and dependency review

**Labels:** `security`, `ci`, `infrastructure`

**Issue:** #1796

---

### Description
Container images are built without a Software Bill of Materials (SBOM), are never signed, and
carry no build provenance. Nothing in the cluster checks where an image came from before running
it. That leaves us exposed to supply-chain attacks: a tampered base image, a compromised
dependency, or an image pushed to the registry by someone other than CI would all deploy
without complaint.

### Current Behavior (as found in code)
- [Dockerfile.app](../../Dockerfile.app) builds the Next.js app on `node:22-alpine`. Base images
  are referenced by tag, not digest, so the same tag can resolve to different contents over time.
- [backend/Dockerfile.api](../../backend/Dockerfile.api) builds the Rust API on
  `rust:1.74-bookworm`, also by tag. It's a dev-style image (`cargo run`), not a slim runtime image.
- [.github/workflows/ci.yml](../../.github/workflows/ci.yml) (`docker-app` job) builds
  `Dockerfile.app` and smoke-tests it, but does not push, generate an SBOM, sign it, or attest it.
- Helm charts pull images from GHCR (for example
  [helm/charts/next-app/values.yaml](../../helm/charts/next-app/values.yaml),
  [helm/charts/api/values.yaml](../../helm/charts/api/values.yaml)) by tag, with no signature
  verification at admission.
- [renovate.json](../../renovate.json) keeps dependencies current and automerges patch/minor
  updates and vulnerability fixes. Nothing reviews a PR's *newly added* dependencies for known
  vulnerabilities or disallowed licences before merge.
- Existing scanners: [codeql.yml](../../.github/workflows/codeql.yml) and
  [snyk.yml](../../.github/workflows/snyk.yml). Neither produces an SBOM or signs anything.

### Proposed Implementation

**1. SBOM with syft**
- In the image build job, generate an SPDX JSON SBOM per image with
  `anchore/sbom-action` (syft), for example `sbom-next-app.spdx.json`.
- Upload it as a workflow artifact and attach it to the image as a cosign attestation
  (see 2), so the SBOM travels with the image digest.
- Optional: run `grype` against the SBOM and fail on `critical` findings.

**2. cosign signing + provenance**
- Push images to GHCR by digest from CI only.
- Use keyless signing (`sigstore/cosign-installer`, `cosign sign --yes <image>@<digest>`) with the
  GitHub Actions OIDC token. This needs `permissions: id-token: write, packages: write`.
- Generate SLSA build provenance with `actions/attest-build-provenance` (or
  `docker/build-push-action` with `provenance: mode=max` and `sbom: true`).
- Attach the SBOM: `cosign attest --yes --type spdxjson --predicate sbom.spdx.json <image>@<digest>`.
- Pin base images by digest in both Dockerfiles (`node:22-alpine@sha256:…`) and let Renovate
  update the digests (`"pinDigests": true` for the `dockerfile` manager).

**3. Dependency review action**
- Add `.github/workflows/dependency-review.yml` on `pull_request` running
  `actions/dependency-review-action`, with `fail-on-severity: high` and a
  `deny-licenses` list (e.g. `GPL-3.0`, `AGPL-3.0`).
- Covers both `pnpm-lock.yaml` and `Cargo.lock`. Renovate PRs go through it too, so the
  automerge rules in `renovate.json` only fire once it passes.

**4. Policy controller verification**
- Install the Sigstore `policy-controller` in the cluster and label the app namespaces with
  `policy.sigstore.dev/include=true`.
- Add a `ClusterImagePolicy` that requires, for `ghcr.io/<org>/stellar-*`:
  - a keyless signature whose certificate identity matches this repo's workflow
    (`https://github.com/<org>/stellar-creator-portfolio/.github/workflows/<build>.yml@refs/heads/main`)
    and issuer `https://token.actions.githubusercontent.com`
  - an SLSA provenance attestation
- Roll out in `warn` mode first, then switch to `enforce` once every chart deploys signed images.
- Switch Helm image references to digests (`image.digest`) so the image that was verified is the
  one that runs.

### Files Involved
- [Dockerfile.app](../../Dockerfile.app): pin base image digests
- [backend/Dockerfile.api](../../backend/Dockerfile.api): pin base image digests
- [renovate.json](../../renovate.json): enable digest pinning for Docker
- [.github/workflows/ci.yml](../../.github/workflows/ci.yml): build/push/SBOM/sign/attest job
- `.github/workflows/dependency-review.yml` (new)
- `infrastructure/k8s/policy/cluster-image-policy.yaml` (new)
- `helm/charts/*/values.yaml`: digest-based image references
- [SECURITY.md](../../SECURITY.md): how to verify an image

### Action Items
- [ ] SBOM with syft for every published image
- [ ] cosign keyless signing + SLSA provenance attestations
- [ ] Dependency review action on pull requests
- [ ] Policy controller verification (`warn`, then `enforce`)
- [ ] Update docs / README where behaviour changes
- [ ] Add or update tests (see test plan)

### Test Plan
- [ ] CI run on `main` publishes an image, and `cosign verify` succeeds with the expected
      `--certificate-identity` and `--certificate-oidc-issuer`
- [ ] `cosign verify-attestation --type spdxjson` and `--type slsaprovenance` succeed and the SBOM
      lists expected packages (e.g. `next`, `@prisma/client`)
- [ ] A PR that adds a package with a known high-severity CVE is blocked by dependency review
- [ ] In a staging cluster, an unsigned image (`docker push` from a laptop) is rejected by
      the policy controller in `enforce` mode, while a CI-signed image is admitted
- [ ] Existing `docker-app` smoke test still passes with digest-pinned base images

### Verifying an image (for SECURITY.md)
```bash
IMAGE=ghcr.io/<org>/stellar-next-app@sha256:<digest>
cosign verify "$IMAGE" \
  --certificate-identity-regexp 'https://github.com/<org>/stellar-creator-portfolio/.github/workflows/.*@refs/heads/main' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
cosign verify-attestation "$IMAGE" --type spdxjson \
  --certificate-identity-regexp '...' --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  | jq -r '.payload' | base64 -d | jq '.predicate.packages | length'
```
