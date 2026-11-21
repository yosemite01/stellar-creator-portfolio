# AWS infrastructure: IaC parity, drift detection and least-privilege IAM

**Issue:** #1793 · **Area:** infrastructure / AWS · **Status:** Design (not yet implemented)

## Summary

Make infrastructure-as-code the single source of truth for AWS. Tighten IAM to least privilege using IAM Access Analyzer, detect drift between code and the live account on a schedule, and block insecure changes in CI with Checkov.

## Why this matters

Over-privileged IAM roles and long-lived credentials are among the most common root causes of cloud breaches. Resources created or changed by hand ("ClickOps") drift from code, so reviews, audits and disaster recovery all work from a wrong picture.

## Current state

The issue points to `infrastructure/aws` at commit `dd8420b`. On `main` (as of `a3edbdb6`) there is no `infrastructure/` directory, and `dd8420b` isn't in this repository's history. This document assumes Terraform (OpenTofu-compatible) and defines the target layout. If the existing IaC turns out to be CDK or CloudFormation, the controls below still apply. Only the tool commands change.

## Layout

```
infrastructure/aws/
  modules/            # reusable: vpc, eks, rds, redis, s3-bucket, iam-role
  envs/
    staging/          # backend.tf, providers.tf, main.tf, terraform.tfvars
    production/
  policies/           # IAM policy JSON documents, one file per role, reviewed like code
  .checkov.yaml
  .tflint.hcl
```

- Remote state: S3 bucket (versioned, SSE-KMS, public access blocked) plus a DynamoDB lock table, one state per environment.
- All resources carry default tags `{ managed-by = "terraform", repo = "stellar-creator-portfolio", env = ... }`. Drift detection uses the `managed-by` tag to spot unmanaged resources.

## Design

### 1. IAM Access Analyzer to tighten policies

**Workload identity**

- No IAM users with access keys for workloads or CI.
- **CI → AWS:** GitHub OIDC (`token.actions.githubusercontent.com`). Two roles per environment:
  - `gh-plan-<env>`: read-only, assumable from any PR (`sub: repo:<org>/<repo>:pull_request`).
  - `gh-apply-<env>`: write, assumable only from `main` via the protected GitHub Environment (`sub: repo:<org>/<repo>:environment:<env>`).
- **Pods → AWS:** EKS IRSA or Pod Identity, with one role per service account (`api`, `stellar`, `ai-worker`). Never use the node instance role for app access.

**Tightening loop**

1. Enable an account-level **Access Analyzer** (external access) and the **unused access analyzer** in each account.
2. For each role, run policy generation from CloudTrail (`aws accessanalyzer start-policy-generation`) over a 90-day window and commit the generated actions to `policies/<role>.json`.
3. Scope `Resource` to specific ARNs. No `"Resource": "*"` except for actions that require it (documented inline).
4. Add conditions where they apply: `aws:SourceVpce`, `s3:prefix`, `kms:ViaService` and `aws:RequestedRegion`.
5. In CI, run `aws accessanalyzer validate-policy` on every changed policy (fail on `ERROR` and `SECURITY_WARNING`) and `check-no-new-access` against the version on `main`. Changes that add access need an explicit `iam-change-approved` PR label from a CODEOWNER.
6. Each month, review the unused access findings and remove permissions and roles that haven't been used for 90 days.

**Guardrails:** A permissions boundary is attached to every role Terraform creates, so no role can create a more privileged role. If AWS Organizations is used, SCPs deny disabling CloudTrail/GuardDuty/Access Analyzer and deny use outside the approved regions.

### 2. Drift detection job

`.github/workflows/aws-drift.yml`, scheduled daily at 06:00 UTC and runnable manually:

```yaml
on:
  schedule: [{ cron: "0 6 * * *" }]
  workflow_dispatch:
permissions: { id-token: write, contents: read, issues: write }
jobs:
  drift:
    strategy: { matrix: { env: [staging, production] } }
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with: { role-to-assume: "arn:aws:iam::<acct>:role/gh-plan-${{ matrix.env }}", aws-region: us-east-1 }
      - uses: hashicorp/setup-terraform@v3
      - run: terraform -chdir=infrastructure/aws/envs/${{ matrix.env }} init -input=false
      - id: plan
        run: terraform -chdir=infrastructure/aws/envs/${{ matrix.env }} plan -detailed-exitcode -refresh-only -input=false -no-color > plan.txt
        continue-on-error: true
      - if: steps.plan.outputs.exitcode == '2'
        run: gh issue create --title "AWS drift detected: ${{ matrix.env }}" --label drift --body-file plan.txt
```

- `-detailed-exitcode`: `0` means no drift, `2` means drift (an issue is opened or updated), `1` means error (the job fails and alerts).
- **Unmanaged resources:** a second step lists resources through the Resource Groups Tagging API that lack `managed-by=terraform` and appends them to the report.
- Optional: AWS Config rules (`required-tags`, `iam-policy-no-statements-with-admin-access`, `s3-bucket-public-read-prohibited`) for continuous detection between runs.
- Fixing drift: either import or codify the change and open a PR, or revert it by applying from `main`. Never leave it unresolved for more than 7 days.

### 3. Checkov in CI

`.github/workflows/aws-iac.yml`, triggered on PRs touching `infrastructure/aws/**`:

1. `terraform fmt -check -recursive`
2. `tflint --recursive`
3. `checkov -d infrastructure/aws --config-file infrastructure/aws/.checkov.yaml --output sarif`, with results uploaded to GitHub code scanning.
4. `terraform plan` per environment using `gh-plan-<env>`, posted as a PR comment.
5. IAM policy validation (section 1, step 5).

`.checkov.yaml`:

```yaml
framework: [terraform]
soft-fail: false
skip-check: []   # each skip must be inline: #checkov:skip=CKV_AWS_xxx: <justification>
```

Inline skips without a justification fail review.

## Test plan

| Test | How |
|---|---|
| Checkov blocks a known-bad fixture (public S3 bucket, `*:*` policy, unencrypted RDS) | `tests/fixtures/bad/` scanned in CI; expect non-zero exit |
| Checkov passes the real modules | CI run on `infrastructure/aws` |
| Module behaviour (tags applied, encryption on, boundary attached) | `terraform test` (`*.tftest.hcl`) per module |
| Policy validation catches a `SECURITY_WARNING` (e.g. `iam:PassRole` on `*`) | fixture policy in CI |
| Drift job opens an issue | Staging: change a tag manually, run `workflow_dispatch`, confirm the issue, revert |
| OIDC trust: a PR cannot assume the apply role | Attempt from a PR workflow; expect `AccessDenied` |

## Docs to update

- `infrastructure/aws/README.md`: layout, bootstrapping remote state, running plan locally with SSO, how to request new IAM permissions, and the drift response runbook.
- `CONTRIBUTING.md`: "Infrastructure changes" section (PR label, CODEOWNERS, never apply locally to production).
- `.github/CODEOWNERS`: `infrastructure/aws/ @<platform-team>`.

## Acceptance criteria

- [ ] All AWS resources for both environments are defined in code and tagged `managed-by=terraform`.
- [ ] No IAM users with long-lived keys; CI uses OIDC; pods use IRSA/Pod Identity.
- [ ] Every role's policy is scoped by Access Analyzer evidence and passes `validate-policy` with no security warnings.
- [ ] The daily drift job runs and opens an issue on drift or unmanaged resources.
- [ ] Checkov, tflint and policy validation are required checks on infra PRs.
