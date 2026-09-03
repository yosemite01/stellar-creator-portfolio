# 📌 Issue Preview: UX — improve the empty-state copy on the compare page

**Labels:** `frontend`, `ux`, `copy`

**Issue:** #1192

---

### Description
When there's no data yet, the compare page shows generic/placeholder-ish copy instead of a
friendly, actionable empty state. A short message plus a clear next action (e.g. a CTA button)
would read better.

Copy and empty states are easy to overlook during feature work because the happy path is what
gets tested, but the empty/edge state is often what a new or returning user actually sees first.

### Current Behavior (as found in code)
[app/compare/page.tsx](app/compare/page.tsx) has no in-page empty state at all today. When the
`ids` query param is missing, or fewer than two creators match it, the page silently
`router.push('/creators')`s the user away (lines 18–30) with no message explaining why they were
redirected. [components/ComparisonBar.tsx](components/ComparisonBar.tsx) similarly renders
`null` when fewer than two creators are selected (line 13), so there is no visible affordance
guiding the user toward comparing creators in the first place.

### Files Involved
- [app/compare/page.tsx](app/compare/page.tsx) — owns the redirect-on-empty logic; needs an
  actual empty state instead of (or before) the silent redirect
- [components/ComparisonBar.tsx](components/ComparisonBar.tsx) — the sticky bar that surfaces
  the "Compare Now" CTA once 2+ creators are selected
- [components/creator-card.tsx](components/creator-card.tsx) — where creators are added to a
  comparison in the first place

### Action Items
- [ ] Replace the silent redirect in `ComparePage` with a real empty state (what happened + why)
      when `ids` is missing or fewer than 2 creators matched
- [ ] Add a clear next-step CTA (e.g. "Browse creators to compare") that routes to `/creators`
- [ ] Match copy tone/voice to the rest of the app (see other empty states for reference)
- [ ] Verify by navigating to `/compare` directly with no/invalid `ids`, not just by inspecting
      the component visually
