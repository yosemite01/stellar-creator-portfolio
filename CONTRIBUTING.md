# Contributing to Tamgora

Thank you for your interest in contributing! This document covers setup,
workflow, code style, testing, and the PR/merge process for this repo.

## Code of Conduct

- Be respectful and inclusive
- Welcome feedback and criticism
- Focus on the code, not the person
- Help others learn and grow

## Getting Started

### Prerequisites

- Node.js 20 (matches `.github/workflows/cli-checks.yml`'s pinned `node-version: 20` — there's
  no `.nvmrc` yet, see `docs/MAINTENANCE_NOTES.md`)
- pnpm 10+ (pinned via `packageManager` in `package.json`)
- Rust 1.74+ (for backend/contract work — matches `backend/Cargo.toml`'s `rust-version`)
- Git

### Setup Development Environment

1. **Fork and Clone**
   ```bash
   git clone https://github.com/<your-username>/stellar-creator-portfolio.git
   cd stellar-creator-portfolio
   ```

2. **Install Frontend Dependencies**
   ```bash
   pnpm install
   ```

3. **Start Development Server**
   ```bash
   pnpm dev
   # Open http://localhost:3000
   ```

4. **Backend Setup (Optional)**
   ```bash
   cd backend
   cargo build --release
   ```

## Project Structure

- **Frontend**: `app/` (routes), `components/` (UI), `lib/` (helpers)
- **Backend**: `backend/services/*` (Rust services), `backend/contracts/*`
  (Soroban smart contracts)
- **Tests**: `__tests__/` (unit + `*.e2e.test.ts` for E2E)
- **Docs**: [`docs/BACKLOG.md`](docs/BACKLOG.md) for priority ordering,
  [`IMPLEMENTATION_NOTES.md`](IMPLEMENTATION_NOTES.md) for implementation
  specs of in-progress work

## Development Workflow

### Creating a Feature

```bash
git checkout -b feature/your-feature-name
# feature/*, bugfix/*, docs/*, chore/*
```

- Keep commits small and focused
- Write descriptive commit messages
- Test your changes thoroughly

### Commit Message Format

Conventional commits:

```
type(scope): description
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`

## Code Style

### Frontend (TypeScript/React)

```bash
pnpm lint            # ESLint
pnpm run check-frontend  # lint + `next build` (surfaces TypeScript errors — there's no standalone tsc --noEmit script)
```

- Use `const` by default, avoid `var`
- Prefer arrow functions and functional components with hooks
- Keep components focused; extract reusable logic into hooks

### Backend (Rust)

```bash
cargo fmt
cargo clippy
cargo test
```

## Testing

```bash
pnpm run cli-checks     # frontend lint/i18n + backend clippy + contract clippy — run before pushing
pnpm test               # vitest — unit tests AND the *.e2e.test.ts files under __tests__/
                        # (vitest's default include pattern picks up both; there's no separate
                        # command for just the *.e2e.test.ts subset)
pnpm run test:e2e       # Playwright — testDir is ./tests (currently just tests/auth.e2e.ts),
                        # a different suite from the vitest *.e2e.test.ts files above despite
                        # the similar naming
```

There is no `test:ci` script — run `pnpm test` and `pnpm run test:e2e` separately.

- Write tests as you code — happy path and edge cases
- New frontend features that call out to an external flow (anchors, payment
  providers, contracts) should scope E2E coverage as part of the same PR, not
  a separate follow-up ticket

## Documentation

- Update relevant docs with feature changes; keep `docs/BACKLOG.md` and
  `IMPLEMENTATION_NOTES.md` cross-linked rather than letting a third,
  untracked doc start drifting
- Documentation changes should land in the same PR as the code change they
  describe, not as a standalone doc-only commit to `main`

## Pull Request Process

### Before Submitting

- [ ] Code follows style guidelines
- [ ] `pnpm run cli-checks` passes locally
- [ ] Tests written and passing
- [ ] Docs updated if behavior/process changed

### PR Description

```markdown
## Description
Brief description of changes

## Related Issues
Closes #123

## Testing
How were changes tested?
```

## Merge Bypass Policy (`gh pr merge --admin`)

CI on this repo runs several independent checks (Snyk, Vercel, backend,
frontend, contracts, cli-checks). Bypassing a red check with
`gh pr merge --admin` (or an equivalent admin override) is **the exception,
not the default**, and is only acceptable when **all** of the following hold:

- The failure is on a **dependency bump / chore PR**, not a feature or bug
  fix PR.
- The failure has been **confirmed pre-existing or an unrelated flake** —
  e.g. it also fails on `main` at the same commit, or it's a known-flaky
  check being tracked separately — and that confirmation is noted in the PR
  before merging.
- The specific failing check(s) are named in the merge/PR comment, along with
  why each one is safe to bypass.

It is **never** acceptable to bypass CI to merge a feature PR, a bug fix, or
any change to `backend/contracts/*` — those failures block the merge until
fixed. If you're unsure whether a failure qualifies for bypass, ask for
review rather than merging with `--admin`.

## Branching Strategy

```
main (production-ready)
  ↓
feature/* (new features)
bugfix/* (bug fixes)
docs/* (documentation)
chore/* (maintenance)
```

## Getting Help

- **Docs**: See [`README.md`](README.md), [`docs/BACKLOG.md`](docs/BACKLOG.md)
- **Issues**: Search existing issues before creating new ones

## License

By contributing, you agree that your contributions will be licensed under the
MIT License.

Thank you for helping improve Tamgora!
