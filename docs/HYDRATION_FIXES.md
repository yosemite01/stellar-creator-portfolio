# Next.js React Hydration Mismatch Fixes

Single canonical doc — replaces the previous `docs/HYDRATION_FIX_GUIDE.md`
and `docs/HYDRATION_FIX_SUMMARY.md`, which covered the same fixes at two
levels of repetition.

## Problem

Server-rendered HTML disagreed with the client's first render, most visibly
on heavy charts: hydration warnings in the console, layout shift on chart
load, the mobile-detection hook flickering, and the theme toggle briefly
disappearing then reappearing.

## Root causes and fixes

### 1. State initialized differently on server vs. client

```typescript
// ❌ Server renders undefined, client renders a boolean
const [isMobile, setIsMobile] = useState<boolean | undefined>(undefined);

// ✅ Both render false initially; update after mount
const [isMobile, setIsMobile] = useState<boolean>(false);
```

Applied in [`components/ui/use-mobile.tsx`](../components/ui/use-mobile.tsx):
state now initializes to `false`, with a `mounted` flag gating the real
value until after the first client render.

### 2. Browser APIs accessed without a guard

```typescript
// ❌ Crashes during SSR
const width = window.innerWidth;

// ✅
if (typeof window !== 'undefined') {
  const width = window.innerWidth;
}
```

Applied in
[`app/providers/AnalyticsClient.tsx`](../app/providers/AnalyticsClient.tsx)
for its click, scroll, and form-change listeners.

### 3. Recharts `ResponsiveContainer` measuring DOM on mount

`ResponsiveContainer` measures its container after mount, which shifts
layout on first paint. Fixed by deferring the chart's render until after
mount, via a new wrapper:
[`components/ui/chart-wrapper.tsx`](../components/ui/chart-wrapper.tsx)
(`ChartWrapper`) — renders a fixed-aspect-ratio placeholder until
`mounted`, then the real `ChartContainer`.

### 4. DOM mutations in `useEffect` without cleanup

```typescript
useEffect(() => {
  if (typeof document === 'undefined') return;
  const prev = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  return () => {
    document.body.style.overflow = prev;
  };
}, []);
```

## Reusable utilities

[`lib/hydration/hydration-safe.tsx`](../lib/hydration/hydration-safe.tsx)
provides:

- `HydrationSafe` — wrapper component: renders `fallback` until mounted, the
  real children after.
- `SafeDate` — formats dates safely across SSR/client with proper `dateTime` attribute and `suppressHydrationWarning`.
- `SafeNumber` — formats numbers and currency with deterministic locale and `suppressHydrationWarning`.
- `useMounted()` — `true` only after mount.
- `useClientOnly()` — `true` only after mount.
- `useBrowserOnly(getValue, defaultValue)` — safely reads a browser-only
  value, falling back to `defaultValue` on the server/before mount.
- `useWindow()`, `useDocument()` — safe accessors for the global objects.
- `useIsMobileViewport(breakpoint)`, `usePrefersDarkMode()`,
  `usePrefersReducedMotion()` — common media-query-driven checks, all
  hydration-safe.

```typescript
import { HydrationSafe, SafeDate, SafeNumber } from '@/lib/hydration/hydration-safe';

<HydrationSafe fallback={<Skeleton />}>
  <ExpensiveChart />
</HydrationSafe>;

<SafeDate date={bounty.deadline} format="date" />
<SafeNumber value={bounty.budget} style="currency" />
```

## Automated Hydration Detection and CI Gate (Issue #1826)

To prevent hydration regressions from reaching production:

1. **Static Hazard Detection (`pnpm run check:hydration`)**:
   Runs `scripts/check-hydration-hazards.mjs`, scanning component trees for unguarded `window`/`document` access, `Math.random()` in render bodies, and dynamic date expressions.
2. **Playwright E2E Hydration Suite (`pnpm run test:hydration`)**:
   Runs `e2e/hydration.spec.ts`, navigating through all core application routes (`/`, `/creators`, `/bounties`, `/freelancers`) and failing loudly if any React hydration mismatch errors or warnings are emitted in the browser console.
3. **CI Pipeline Integration**:
   `check:hydration` runs as a mandatory check in `.github/workflows/ci.yml` on every pull request.

## Patterns to follow / avoid

| Don't | Do |
|---|---|
| `useState(window.innerWidth)` | `useState(1024)`, then set the real value in `useEffect` |
| `window.innerWidth < 768` at render time | Guard with `typeof window !== 'undefined'`, or use `useIsMobileViewport()` |
| `return isClient ? <A/> : <B/>` (different trees) | `<HydrationSafe fallback={<B/>}><A/></HydrationSafe>`, or `suppressHydrationWarning` as a last resort |

## Debugging a hydration warning

1. Read the component name out of the console warning
   (`Expected server HTML to contain a matching <div> in <div>`).
2. Check that component's state initializers for anything that could differ
   between server and client.
3. Check for unguarded `window`/`document`/`localStorage` access.
4. Confirm any browser-only logic runs inside `useEffect`, not at render
   time.
5. Reproduce against a production build (`npm run build && npm run start`)
   — dev-mode warnings and prod hydration behavior aren't always identical.

## References

- [Next.js: hydration error](https://nextjs.org/docs/messages/react-hydration-error)
- [React: `hydrateRoot`](https://react.dev/reference/react-dom/client/hydrateRoot)
- [Recharts SSR guide](https://recharts.org/en-US/guide/ssr)
