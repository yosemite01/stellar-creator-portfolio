# Branch Protection & Code Ownership

This document describes the branch protection rules and code ownership requirements for the stellar-creator-portfolio repository.

## Overview

The `main` branch is protected to ensure code quality and security through mandatory code reviews on critical paths. The `.github/CODEOWNERS` file automatically designates required reviewers for pull requests that touch protected paths.

## Enabling "Require review from Code Owners"

To activate the branch protection rules in GitHub:

1. **Go to Repository Settings**
   - Navigate to your repository on GitHub
   - Click **Settings** (top menu bar)
   - Select **Branches** in the left sidebar

2. **Add or Edit Branch Protection Rule**
   - Under "Branch protection rules", click **Add rule** (or edit existing rule for `main`)
   - Set the following:
     - **Branch name pattern**: `main`
     - ✓ **Require a pull request before merging**
     - ✓ **Require approvals**: Set to `1` (minimum reviewers)
     - ✓ **Require review from Code Owners**: Enable this option
     - ✓ **Dismiss stale pull request approvals when new commits are pushed**
     - ✓ **Require branches to be up to date before merging** (recommended)

3. **Save Changes**
   - Click **Create** or **Update** to apply the rule

## Protected Paths & Owners

The following critical paths require review from @yosemite01 (or designees as the team grows):

| Path | Purpose | Owner |
|------|---------|-------|
| `/prisma/` | Database schema & types | @yosemite01 |
| `/app/api/` | API route handlers & endpoints | @yosemite01 |
| `/backend/` | Backend services & business logic | @yosemite01 |
| `/backend/services/indexer/` | Stellar blockchain indexer | @yosemite01 |
| `/lib/auth/` | Authentication & authorization | @yosemite01 |
| `/middleware.ts` | Request middleware | @yosemite01 |
| `/app/api/admin/` | Admin endpoints & internal APIs | @yosemite01 |
| `/prisma/migrations/` | Database migration scripts | @yosemite01 |
| `/contracts/` | Smart contracts (Soroban/Stellar) | @yosemite01 |
| `/.github/workflows/` | CI/CD pipelines | @yosemite01 |
| Configuration files | `next.config.mjs`, `tsconfig.json`, `package.json`, etc. | @yosemite01 |
| `/mobile/src/database/` | Mobile database & sync logic | @yosemite01 |
| `/mobile/src/navigation/` | Mobile app navigation/routes | @yosemite01 |

## Adding New Code Owners

As the team grows, designate additional code owners by:

1. **Identify the new owner** (GitHub username or team handle)
2. **Edit `.github/CODEOWNERS`** and add the owner to relevant paths
3. **Create a PR** with the CODEOWNERS changes (ironically, this may require its own review!)
4. **Notify the team** in the PR description about the new ownership structure

Example for adding a new owner:
```diff
  # Core infrastructure and dependencies
- /prisma/                    @yosemite01
+ /prisma/                    @yosemite01 @new-owner
```

## How Code Owners Affects PRs

When a PR is opened:

1. **GitHub parses CODEOWNERS** and identifies affected paths
2. **Designates reviewers** — the PR is automatically assigned to the code owners
3. **Requires approval** — the PR cannot be merged without at least one approval from a designated owner
4. **Stale reviews dismissed** — if new commits are pushed, previous approvals are cleared (if enabled)

## Exemptions & Overrides

### Emergency Merges

If an emergency fix is needed and a code owner is unavailable:

1. Request explicit approval from **repository admins** or **GitHub organization owners**
2. Bypass temporary protection (if authorized) with admin approval
3. **Always document the override** in the PR with explanation

### Automation & Bot PRs

For dependabot or automated tool PRs:

1. Consider creating an **automation exception rule** if many false positives occur
2. Or require `@yosemite01` to review and approve automation changes before auto-merge

## Rationale for Each Protected Path

- **`/prisma/`**: Database schema changes affect all systems; requires careful review
- **`/app/api/` & `/backend/`**: APIs and business logic are critical to platform integrity
- **`/lib/auth/`**: Authentication is security-critical
- **`/contracts/`**: Smart contracts cannot be easily patched; require thorough review
- **CI/CD (`.github/workflows/`)**:  Pipeline changes can leak secrets or compromise builds
- **Config files**: Package versions, Next.js config, TypeScript settings affect the entire app
- **Mobile database**: Data sync issues can corrupt user state across devices

## Monitoring & Auditing

To audit code ownership decisions:

```bash
# View recent PRs and their approvals:
gh pr list --state merged --limit 20 --json title,author,reviews

# Search for overrides or admin approvals:
gh pr list --search "is:merged label:emergency" --limit 50
```

## Questions or Issues?

Contact @yosemite01 or open an issue in the repository to discuss code ownership changes or exemptions.
