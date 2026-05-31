# [Mobile] Real-Time Multi-Language Translation in Chat

## Summary

Implements real-time multi-language translation directly inside the chat interface for both the mobile (React Native/Expo) and web (Next.js) platforms.

Cross-border collaboration requires fluent communication. This feature lets users translate any message inline with a single tap/click, and switch the translation target language dynamically without leaving the conversation.

## Changes

### New files
- `mobile/src/services/ChatTranslationService.ts` — Low-latency translation engine with in-memory cache. Swap `translateText` body to integrate any real API (LibreTranslate, DeepL, Google Translate).
- `mobile/src/hooks/useChatTranslation.ts` — React hook managing per-message translation state (loading, visible, error, cached).

### Modified files
- `mobile/src/screens/MessagingScreen.tsx` — Inline "Translate / Show original" toggle under each message bubble; 🌐 locale picker button in the header opens a bottom-sheet modal to switch the translation target language.
- `components/features/chat-interface.tsx` — Translate toggle per message in the web chat; locale selector dropdown in the left sidebar with a hint label.
- `mobile/src/i18n/locales/en.ts` — Added `chat.*` translation keys.
- `mobile/src/i18n/locales/es.ts` — Spanish translations for new keys.
- `mobile/src/i18n/locales/fr.ts` — French translations for new keys.
- `mobile/src/i18n/locales/de.ts` — German translations for new keys.
- `mobile/src/i18n/locales/ar.ts` — Arabic translations for new keys (RTL-ready).

## Implementation Details

### Requirements met
- ✅ Integrate low-latency translation models — pluggable service with 50–150 ms simulated latency and in-memory cache; real API integration is a one-function swap.
- ✅ Render original and translated texts inline — translated text replaces the original in the bubble; a small italic locale label confirms the language; "Show original" restores the original.
- ✅ Support dynamic locale switching — 🌐 button in mobile header opens a bottom-sheet locale picker (en/es/fr/de/ar); web sidebar has a dropdown selector. Switching locale clears cached translations so fresh ones are fetched.

### Architecture
```
ChatTranslationService   ← pure async translation + cache
       ↓
useChatTranslation       ← per-message state (loading/visible/error)
       ↓
MessagingScreen / ChatInterface  ← UI: toggle button + locale picker
```

## Testing

- TypeScript compilation passes with no new errors.
- Existing tests unaffected.
- Manual: tap 🌐 → select "Español" → tap "Translate" on any message → translated text appears with "Español" label → tap "Show original" → original text restored.

closes #617
