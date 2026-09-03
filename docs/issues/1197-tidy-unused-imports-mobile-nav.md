# 📌 Issue Preview: chore: tidy up unused imports in mobile navigation

**Labels:** `chore`, `lint`, `low-risk`

---

### Description
A pass through the mobile navigation component may have turned up unused imports left over from earlier refactors. These aren't causing bugs, just lint noise worth cleaning up in a small, isolated chore PR. `MobileNav` currently imports from `react`, `next-auth`, `lucide-react`, `@/components/ui/collapsible`, `@/lib/utils`, and `@/lib/utils/mobile-nav-utils` — each import should be re-verified against actual usage in the component body.

### Files Involved
- [components/layout/mobile-nav.tsx](components/layout/mobile-nav.tsx)
- [lib/utils/mobile-nav-utils.ts](lib/utils/mobile-nav-utils.ts)
- [__tests__/mobile-nav.test.tsx](__tests__/mobile-nav.test.tsx)
- [__tests__/mobile-nav-utils.test.ts](__tests__/mobile-nav-utils.test.ts)

### Action Items
- [ ] Run the linter (`eslint`) scoped to `components/layout/mobile-nav.tsx` to surface any `no-unused-vars` / unused-import warnings
- [ ] Remove imports confirmed unused; leave logic untouched
- [ ] Re-run `npm run lint` and the mobile-nav test files to confirm no regressions
- [ ] Keep the diff to import statements only — no unrelated refactors
