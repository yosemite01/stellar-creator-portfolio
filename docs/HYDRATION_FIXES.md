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
- `useClientOnly()` — `true` only after mount.
- `useBrowserOnly(getValue, defaultValue)` — safely reads a browser-only
  value, falling back to `defaultValue` on the server/before mount.
- `useWindow()`, `useDocument()` — safe accessors for the global objects.
- `useIsMobileViewport(breakpoint)`, `usePrefersDarkMode()`,
  `usePrefersReducedMotion()` — common media-query-driven checks, all
  hydration-safe.

```typescript
import { HydrationSafe } from '@/lib/hydration/hydration-safe';

<HydrationSafe fallback={<Skeleton />}>
  <ExpensiveChart />
</HydrationSafe>;
```

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
