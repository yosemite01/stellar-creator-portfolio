# 📌 Issue Preview: Clarify how to run the mobile app in the simulator in the README

**Labels:** `documentation`, `mobile`, `good-first-issue`

**Issue:** #1190

---

### Description
New contributors following the README run into ambiguity around how to run the mobile app in
the simulator — the steps work but aren't spelled out clearly enough to follow without asking in
chat. Worth tightening the wording with a concrete example.

Docs are often the first thing a new contributor or teammate reads, so a small gap here has an
outsized cost: it turns a 2-minute setup step into a back-and-forth in chat, or leaves an
assumption undocumented that someone has to rediscover the hard way.

### Current Behavior (as found in docs)
[mobile/README.md](mobile/README.md#L258-L274), "Running the App" → "Development", lists the
raw commands (`npm start`, `npm run ios`, `npm run android`, `npm run web`) with no mention of
prerequisites (Xcode/Android Studio installed, a simulator already booted, `expo-cli`/Expo Go),
no expected output (e.g. the QR code / Metro bundler screen), and no note on what happens if no
simulator is running. That's the ambiguity contributors are hitting.

### Files Involved
- [mobile/README.md](mobile/README.md) — lines 258–274 is the section to expand
- [README.md](README.md) — root README; check for any duplicate/summarized version of these
  steps that would need to stay in sync

### Action Items
- [ ] Add a prerequisites line (Xcode + iOS Simulator for `npm run ios`; Android Studio + an
      AVD for `npm run android`)
- [ ] Spell out the concrete flow for `npm start`: what command to run, what output to expect
      (Metro bundler / QR code), and how to open it in a simulator from there (e.g. pressing `i`
      / `a` in the Expo CLI, vs. running `npm run ios` / `npm run android` directly)
- [ ] Note what to do if no simulator is running (e.g. Expo will prompt/launch one, or the
      contributor needs to boot one first)
- [ ] Check root [README.md](README.md) for any older/incomplete restatement of these steps and
      update or link to the mobile README instead of duplicating
- [ ] Have someone unfamiliar with the mobile setup follow the updated section start-to-finish
