# 📌 Issue Preview: chore: bump tailwind-merge to its latest minor release

**Labels:** `chore`, `dependencies`, `low-risk`

---

### Description
`tailwind-merge` is pinned to `^3.3.1` in [package.json](package.json#L77), while the latest available release is `3.6.0`. Bumping it picks up upstream bug fixes and keeps the dependency tree from drifting further behind. No breaking API changes are expected at this version range — `tailwind-merge` has stayed on the `3.x` major since `3.3.1`.

### Files Involved
- [package.json](package.json#L77)
- `package-lock.json` / `pnpm-lock.yaml` (whichever is authoritative for installs)

### Action Items
- [ ] Bump `tailwind-merge` from `^3.3.1` to `^3.6.0` in `package.json`
- [ ] Regenerate the lockfile so the resolved version matches
- [ ] Skim the [tailwind-merge changelog](https://github.com/dcastil/tailwind-merge/blob/main/CHANGELOG.md) between `3.3.1` and `3.6.0` for anything relevant to this codebase's `cn()` usage
- [ ] Run the existing test/build suite (`npm run build`, `npm test`) to confirm nothing regresses
- [ ] Keep the diff scoped to this dependency only — no unrelated lockfile churn
