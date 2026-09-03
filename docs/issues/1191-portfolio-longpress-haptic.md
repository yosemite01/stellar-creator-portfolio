# 📌 Issue Preview: Add haptic feedback when long-pressing a portfolio item

**Labels:** `mobile`, `enhancement`, `polish`

**Issue:** #1191

---

### Description
On supported devices, long-pressing a portfolio item currently has no haptic feedback, which
makes the interaction feel a bit flat compared to the rest of the app. A short haptic pulse
would be a small but noticeable polish item.

This isn't fixing something broken — it's closing a small gap between what the product does
today and what would feel more polished/complete. Low effort, but the kind of detail users
notice.

### Current Behavior (as found in code)
[mobile/src/components/portfolio/OptimizedPortfolioGrid.tsx](mobile/src/components/portfolio/OptimizedPortfolioGrid.tsx)
renders each portfolio item as a `TouchableOpacity` wired only to `onPress` (line 108–110) —
there is no `onLongPress` handler at all, so there's nothing to attach haptics to yet.

The app already has a shared haptics abstraction that other screens use for exactly this kind of
interaction, so this doesn't need a new pattern:
- [mobile/src/haptics/HapticEngine.ts](mobile/src/haptics/HapticEngine.ts) — `trigger(pattern)`
  with `light` / `medium` / `success` / `heavy` / `error` / `selection` patterns, already
  respects the user's haptics-enabled setting
- [mobile/src/hooks/useHapticSettings.ts](mobile/src/hooks/useHapticSettings.ts) — hook for
  reading/writing the haptics-enabled preference

### Files Involved
- [mobile/src/components/portfolio/OptimizedPortfolioGrid.tsx](mobile/src/components/portfolio/OptimizedPortfolioGrid.tsx) —
  add an `onLongPress` handler to the item `TouchableOpacity`
- [mobile/src/haptics/HapticEngine.ts](mobile/src/haptics/HapticEngine.ts) — reuse `trigger()`
  rather than calling `expo-haptics` directly

### Action Items
- [ ] Add `onLongPress` to the portfolio item touchable in `OptimizedPortfolioGrid`
- [ ] Call `HapticEngine.trigger('medium')` (or the pattern that best matches similar
      long-press/selection interactions elsewhere in the app) from that handler
- [ ] Confirm it respects the existing haptics-enabled setting (no new toggle needed)
- [ ] Verify no regression to the existing `onPress` tap behavior on the same item
