# Contributing to Stellar Creator Portfolio

## Pre-Commit Hooks

This project uses Git hooks to ensure code quality and prevent secrets from being committed. Hooks run automatically before each commit.

### Installing Hooks

After cloning the repository, install the hooks:

```bash
pnpm prepare
```

Or manually:

```bash
npx husky install
```

### What Hooks Do

1. **File Size Check** — Prevents files larger than 10MB from being committed.

2. **TypeScript Type Checking** — Runs incremental TypeScript compilation:
   ```bash
   pnpm exec tsc --noEmit --incremental
   ```
   Ensures no type errors exist in committed code.

3. **Rust Clippy** — Runs on any `.rs` files being committed:
   ```bash
   cargo clippy --all-targets -- -D warnings
   ```
   Enforces Rust best practices.

4. **Secret Scanning** — Uses gitleaks to prevent secrets from being committed:
   ```bash
   pnpm exec gitleaks protect --staged --redact
   ```
   Configuration in `.gitleaks.toml` excludes common false positives.

5. **SQL Migration Safety** — Blocks `DROP TABLE` statements without `IF EXISTS`:
   ```sql
   DROP TABLE users;  ❌ BLOCKED
   DROP TABLE IF EXISTS users;  ✅ ALLOWED
   ```

### Bypassing Hooks (Emergency Only)

In rare cases, you can skip hooks:

```bash
git commit --no-verify
```

⚠️ **Important:** A subsequent PR must be opened to address any skipped checks. Do not make this a habit.

### Troubleshooting

#### TypeScript errors on commit
Fix type errors in your code, then stage and commit again.

#### Clippy warnings on commit
Run `cargo clippy --all-targets -- -D warnings` in the `backend/` directory to see issues, fix them, and re-commit.

#### Secret scanner false positives
- Add the pattern to `.gitleaks.toml` under `allowlist.regexes` or `allowlist.paths`
- Ensure the pattern targets only non-secret content (e.g., template strings, placeholder text)

#### Pre-commit hook permissions
If you see "permission denied" when committing:

```bash
chmod +x .husky/pre-commit
```

## Code Style

- **TypeScript**: Use ESLint (`pnpm lint`)
- **Rust**: Follow clippy suggestions
- **SQL**: Use lowercase keywords, always include `IF EXISTS` on destructive operations

## Testing

Run tests before committing:

```bash
pnpm test
pnpm test:watch
cargo test  # for backend
```

## Commit Messages

Use clear, concise commit messages:

```
feat: add background audio playback with lock screen controls
fix: resolve bounty escrow funding race condition
docs: update deployment guide
```

Commit messages closing issues:

```
feat: add email bounce handling and unsubscribe flow (#802)
```

## Pull Requests

- Keep PRs focused on a single issue or feature
- Link related issues in the PR description
- Ensure all checks pass before requesting review
- Provide context on why changes were made, not just what changed
