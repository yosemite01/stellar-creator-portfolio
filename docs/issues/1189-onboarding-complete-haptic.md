# 📌 Issue Preview: Add haptic feedback when completing onboarding

**Labels:** `mobile`, `enhancement`, `polish`

**Issue:** #1189

---

### Description
On supported devices, completing onboarding currently has no haptic feedback, which makes the
interaction feel a bit flat compared to the rest of the app. A short haptic pulse would be a
small but noticeable polish item.

This isn't fixing something broken — it's closing a small gap between what the product does
today and what would feel more polished/complete. Low effort, but the kind of detail users
notice.

### Current Behavior (as found in code)
[mobile/src/components/onboarding/OnboardingWalkthrough.tsx](mobile/src/components/onboarding/OnboardingWalkthrough.tsx#L101-L113)
already fires a haptic on every step transition, including the final one:

- `handleNext` (line 101) fires `Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)` for
  *every* step, then calls `onComplete()` on the last step
- `handleSkip` (line 110) fires `Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)`

So the gap isn't a total absence of haptics — it's that "completing onboarding" gets the exact
same generic `Light` pulse as advancing to any other step, calling `expo-haptics` directly
instead of the shared engine. There's no distinct feel for the moment onboarding actually
finishes.

The app already has a shared haptics abstraction with a pattern built for exactly this kind of
"meaningful completion" moment, which other screens use instead of calling `expo-haptics`
directly:
- [mobile/src/haptics/HapticEngine.ts](mobile/src/haptics/HapticEngine.ts) — `trigger('success')`
  maps to `NotificationFeedbackType.Success` (three pulses), documented as the pattern for
  moments like "payment sent"; also respects the user's haptics-enabled setting, which the
  direct `expo-haptics` calls in `OnboardingWalkthrough` currently do not
- [mobile/src/hooks/useHapticSettings.ts](mobile/src/hooks/useHapticSettings.ts) — hook for
  reading/writing the haptics-enabled preference

### Files Involved
- [mobile/src/components/onboarding/OnboardingWalkthrough.tsx](mobile/src/components/onboarding/OnboardingWalkthrough.tsx) —
  `handleNext`'s `onComplete()` branch (line 103–104) is where a distinct completion haptic
  belongs
- [mobile/src/haptics/HapticEngine.ts](mobile/src/haptics/HapticEngine.ts) — reuse
  `trigger('success')` instead of a raw `expo-haptics` call

### Action Items
- [ ] In `handleNext`, fire `HapticEngine.trigger('success')` specifically on the `isLastStep`
      branch (completion), instead of relying on the generic `Light` pulse shared with regular
      step advances
- [ ] Migrate the existing direct `expo-haptics` calls in this file to `HapticEngine.trigger()`
      so onboarding respects the user's haptics-enabled setting like the rest of the app
- [ ] Confirm no double-haptic fires (the existing per-step `Light` pulse should not stack with
      the new completion pulse)
- [ ] Verify on a physical device/simulator that supports haptics, not just by code inspection
