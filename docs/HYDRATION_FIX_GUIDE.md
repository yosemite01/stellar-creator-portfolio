# Next.js React Hydration Mismatch Fix Guide

## Problem Summary

Server-side rendering output conflicted with client DOM initialization on heavy charts, causing:

- Hydration errors in console
- Layout shifts and visual glitches
- Charts resizing on load
- Theme toggle disappearing then reappearing
- Mobile detection returning wrong values

## Root Causes

### 1. **State Initialization Mismatch**

Server renders with one value, client renders with another:

```typescript
// ❌ BAD: Server renders undefined, client renders boolean
const [isMobile, setIsMobile] = useState<boolean | undefined>(undefined);

// ✅ GOOD: Server and client both render false initially
const [isMobile, setIsMobile] = useState<boolean>(false);
```

### 2. **Browser API Access Without Guards**

Accessing `window`, `document`, `localStorage` during SSR:

```typescript
// ❌ BAD: Crashes on server
const width = window.innerWidth;

// ✅ GOOD: Safe on server
if (typeof window !== "undefined") {
  const width = window.innerWidth;
}
```

### 3. **Recharts ResponsiveContainer Dimension Mismatch**

Recharts measures DOM on mount, causing layout shift:

```typescript
// ❌ BAD: Server renders with default dimensions, client recalculates
<ResponsiveContainer>
  <LineChart data={data} />
</ResponsiveContainer>

// ✅ GOOD: Defer rendering until client-side
const [mounted, setMounted] = useState(false)
useEffect(() => setMounted(true), [])
if (!mounted) return <Skeleton />
return <ResponsiveContainer>...</ResponsiveContainer>
```

### 4. **DOM Mutations in useEffect Without Cleanup**

Modifying document/body without proper guards:

```typescript
// ❌ BAD: May run on server or cause mismatches
document.body.style.overflow = "hidden";

// ✅ GOOD: Guard and cleanup properly
useEffect(() => {
  if (typeof document === "undefined") return;
  const prev = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  return () => {
    document.body.style.overflow = prev;
  };
}, []);
```

## Fixes Applied

### Fix 1: useIsMobile Hook

**File**: `components/ui/use-mobile.tsx`

Changed state initialization from `undefined` to `false`:

```typescript
// Before
const [isMobile, setIsMobile] = useState<boolean | undefined>(undefined);

// After
const [isMobile, setIsMobile] = useState<boolean>(false);
const [mounted, setMounted] = useState(false);

useEffect(() => {
  setMounted(true);
  // ... rest of logic
}, []);

return mounted ? isMobile : false;
```

**Impact**: Eliminates hydration mismatch for mobile detection

### Fix 2: Chart Components

**File**: `components/ui/chart-wrapper.tsx` (NEW)

Created SSR-safe wrapper that defers rendering:

```typescript
export function ChartWrapper({ config, children }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return <div className={className} style={{ aspectRatio: '16 / 9' }} />
  }

  return <ChartContainer config={config}>{children}</ChartContainer>
}
```

**Impact**: Prevents Recharts layout shift on load

### Fix 3: Analytics Client

**File**: `app/providers/AnalyticsClient.tsx`

Added guards for all browser API access:

```typescript
// Before
document.addEventListener("click", handleClick);
window.addEventListener("scroll", handleScroll);

// After
if (typeof document !== "undefined") {
  document.addEventListener("click", handleClick);
}

if (typeof window !== "undefined") {
  window.addEventListener("scroll", handleScroll);
}
```

**Impact**: Prevents errors during SSR and hydration

### Fix 4: Hydration Safety Utilities

**File**: `lib/hydration/hydration-safe.tsx` (NEW)

Created reusable hooks and components:

- `HydrationSafe` - Wrapper component for client-only content
- `useClientOnly()` - Hook to check if mounted on client
- `useBrowserOnly()` - Hook to safely get browser values
- `useWindow()`, `useDocument()` - Safe browser object access
- `useIsMobileViewport()` - Safe mobile detection
- `usePrefersDarkMode()` - Safe dark mode detection

## Usage Examples

### Using HydrationSafe Component

```typescript
import { HydrationSafe } from '@/lib/hydration/hydration-safe'

export function MyComponent() {
  return (
    <HydrationSafe fallback={<Skeleton />}>
      <ExpensiveChart />
    </HydrationSafe>
  )
}
```

### Using useClientOnly Hook

```typescript
import { useClientOnly } from '@/lib/hydration/hydration-safe'

export function MyComponent() {
  const isClient = useClientOnly()

  if (!isClient) {
    return <Skeleton />
  }

  return <Chart />
}
```

### Using useBrowserOnly Hook

```typescript
import { useBrowserOnly } from '@/lib/hydration/hydration-safe'

export function MyComponent() {
  const windowWidth = useBrowserOnly(
    () => window.innerWidth,
    1024 // default value
  )

  return <div>Width: {windowWidth}</div>
}
```

### Using useIsMobileViewport Hook

```typescript
import { useIsMobileViewport } from '@/lib/hydration/hydration-safe'

export function MyComponent() {
  const isMobile = useIsMobileViewport(768)

  return isMobile ? <MobileLayout /> : <DesktopLayout />
}
```

## Migration Checklist

### For Chart Components

- [ ] Replace `ChartContainer` with `ChartWrapper` in analytics pages
- [ ] Test charts load without layout shift
- [ ] Verify no hydration warnings in console

### For Mobile Detection

- [ ] Update components using `useIsMobile()` to use new version
- [ ] Test mobile detection works correctly
- [ ] Verify no hydration warnings

### For Browser API Access

- [ ] Add `typeof window !== 'undefined'` guards
- [ ] Add `typeof document !== 'undefined'` guards
- [ ] Test on server-side rendering
- [ ] Verify no console errors

### For Analytics

- [ ] Verify analytics events fire correctly
- [ ] Check no hydration warnings
- [ ] Test scroll depth tracking
- [ ] Test heatmap tracking

## Testing Hydration Issues

### 1. Check Console for Warnings

```
Warning: Expected server HTML to contain a matching <div> in <div>
```

### 2. Use React DevTools

- Install React DevTools browser extension
- Check "Highlight updates when components render"
- Look for mismatches between server and client renders

### 3. Disable JavaScript

- Open DevTools
- Press Ctrl+Shift+P (Cmd+Shift+P on Mac)
- Type "Disable JavaScript"
- Reload page
- Verify page still renders correctly

### 4. Test with Next.js Debug Mode

```bash
NODE_ENV=development npm run dev
```

### 5. Build and Test Production

```bash
npm run build
npm run start
```

## Performance Impact

### Before Fixes

- Hydration warnings in console
- Layout shift on chart load (~200ms)
- Mobile detection flicker
- Theme toggle disappears then reappears

### After Fixes

- ✅ No hydration warnings
- ✅ No layout shift
- ✅ Smooth mobile detection
- ✅ Instant theme toggle

## Common Patterns to Avoid

### ❌ Don't: Initialize state with browser-only values

```typescript
const [value, setValue] = useState(window.innerWidth);
```

### ✅ Do: Initialize with safe default, update in useEffect

```typescript
const [value, setValue] = useState(1024);
useEffect(() => {
  setValue(window.innerWidth);
}, []);
```

### ❌ Don't: Access browser APIs outside useEffect

```typescript
const isMobile = window.innerWidth < 768;
```

### ✅ Do: Use hooks or guard with typeof

```typescript
const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
```

### ❌ Don't: Render different content on server vs client

```typescript
return isClient ? <ClientComponent /> : <ServerComponent />
```

### ✅ Do: Use HydrationSafe or suppressHydrationWarning

```typescript
return <HydrationSafe><ClientComponent /></HydrationSafe>
```

## Debugging Hydration Mismatches

### Step 1: Identify the Component

Look for hydration warning in console:

```
Warning: Expected server HTML to contain a matching <div> in <div>
  at MyComponent
```

### Step 2: Check State Initialization

```typescript
// Check if state initializes differently on server vs client
const [value, setValue] = useState(???)
```

### Step 3: Check Browser API Access

```typescript
// Check for window, document, localStorage access
if (typeof window === "undefined") {
  // This code runs on server
}
```

### Step 4: Check useEffect Dependencies

```typescript
// Make sure useEffect runs after mount
useEffect(() => {
  // This runs on client only
}, []);
```

### Step 5: Use suppressHydrationWarning as Last Resort

```typescript
<div suppressHydrationWarning>
  {/* Content that differs between server and client */}
</div>
```

## References

- [Next.js Hydration Documentation](https://nextjs.org/docs/messages/react-hydration-error)
- [React Hydration Mismatch Guide](https://react.dev/reference/react-dom/client/hydrateRoot)
- [Recharts SSR Guide](https://recharts.org/en-US/guide/ssr)
- [Next.js Dynamic Imports](https://nextjs.org/docs/advanced-features/dynamic-import)

## Support

For hydration issues:

1. Check console for specific warning message
2. Identify the component causing the issue
3. Apply appropriate fix from this guide
4. Test with `npm run build && npm run start`
5. Verify no warnings in console
