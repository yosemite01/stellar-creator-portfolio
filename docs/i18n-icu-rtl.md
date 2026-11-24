# i18n: ICU Messages, RTL, and Locale-Aware Formatting

**Issue:** [#1774](https://github.com/yosemite01/stellar-creator-portfolio/issues/1774)  
**Difficulty:** Hard · **Estimated size:** L (1–2 weeks)

---

## Background

The app supports five locales (`en`, `es`, `fr`, `de`, `ar`) with a fully custom i18n system. Arabic (`ar`) requires right-to-left layout. The current system handles basic `{{variable}}` substitution but does not support ICU message syntax, server-side message loading, or locale-aware routing. This work upgrades the pipeline to `next-intl` with full ICU support, an extraction/CI check, RTL layout, and locale-aware amounts and dates.

---

## Current State

### Core module — `lib/i18n.ts`

| Capability | Status |
|---|---|
| Locale detection (cookie → localStorage → `navigator.languages`) | ✅ Implemented |
| Locale persistence (cookie + localStorage) | ✅ Implemented |
| RTL flag per locale | ✅ `LOCALE_INFO.ar.rtl = true` |
| Dot-path key resolution | ✅ `getByPath()` |
| `{{variable}}` interpolation | ✅ `interpolate()` |
| Prototype-pollution guards on keys | ✅ `assertSafeMessageKey()` |
| `Intl.DateTimeFormat` wrapper | ✅ `formatLocalizedDate()` |
| `Intl.NumberFormat` currency wrapper | ✅ `formatLocalizedCurrency()` |
| ICU plural / select / ordinal | ❌ Not supported |
| Server-side message loading | ❌ Client-only (`fetch` over HTTP) |

### React layer — `components/providers/i18n-provider.tsx`

`I18nProvider` is a client component. On mount it resolves the locale, calls `loadLocaleMessages()` (which fetches `/public/locales/{locale}.json` via HTTP with `cache: 'force-cache'`), stores the result in state, and sets `<html lang dir class>` on the document root. The `useI18n()` hook exposes `t`, `formatDate`, `formatCurrency`, `formatNumber`, `locale`, `isRtl`, and `isLoading`.

**Limitation:** Server Components cannot call `useI18n()`. There is no server-side `getTranslations()` equivalent.

### Translation files — `public/locales/*.json`

All five locale files exist and are structurally identical. The current key space is thin: `common`, `languageSwitcher`, `nav`, `auth`, `home`. No bounty, creator, error, or form strings are translated yet.

### What is not present

- `next-intl` is not installed.
- No `/[locale]/` URL routing segment.
- No `middleware.ts` locale negotiation.
- No ICU plural/select (e.g., `{count, plural, one {# item} other {# items}}`).
- No RTL utility classes (`rtl:` Tailwind variants, CSS logical properties) in the component layer.
- No missing-key CI check.

---

## Proposed Implementation

### 1. Install next-intl and configure routing

```bash
pnpm add next-intl
```

Add locale routing to `next.config.js` and create `src/i18n.ts` (the `next-intl` routing config):

```ts
// src/i18n.ts
import { notFound } from 'next/navigation';
import { getRequestConfig } from 'next-intl/server';

export const locales = ['en', 'es', 'fr', 'de', 'ar'] as const;
export const defaultLocale = 'en';

export default getRequestConfig(async ({ locale }) => {
  if (!locales.includes(locale as (typeof locales)[number])) notFound();
  return {
    messages: (await import(`../public/locales/${locale}.json`)).default,
  };
});
```

Rename the current `app/` directory to `app/[locale]/` and update `middleware.ts` to use `next-intl/middleware` for locale negotiation.

### 2. Convert translation files to ICU format

Replace `{{variable}}` placeholders with ICU `{variable}` syntax and add plural/select rules:

```json
{
  "bounty": {
    "applicantCount": "{count, plural, =0 {No applicants} one {# applicant} other {# applicants}}",
    "status": "{status, select, open {Open} closed {Closed} draft {Draft} other {Unknown}}"
  }
}
```

`next-intl` uses `intl-messageformat` under the hood, which handles ICU plural, select, ordinal, and date/number skeletons natively.

### 3. Missing-key CI check

Add a script `scripts/check-i18n-keys.ts` that uses `flattenMessageKeys()` (already in `lib/i18n.ts`) to compare all locale files against `en.json` and exits non-zero if any locale is missing a key:

```ts
import en from '../public/locales/en.json';
import { flattenMessageKeys } from '../lib/i18n';

const baseKeys = new Set(flattenMessageKeys(en));
for (const locale of ['es', 'fr', 'de', 'ar']) {
  const msgs = require(`../public/locales/${locale}.json`);
  const keys = new Set(flattenMessageKeys(msgs));
  for (const k of baseKeys) {
    if (!keys.has(k)) {
      console.error(`[i18n] Missing key "${k}" in ${locale}`);
      process.exit(1);
    }
  }
}
```

Add to `package.json`:
```json
"check:i18n": "tsx scripts/check-i18n-keys.ts"
```

Add to `.github/workflows/ci.yml`:
```yaml
- run: pnpm check:i18n
```

### 4. RTL layout support

The `dir` attribute is already applied by `applyDocumentLanguage()`. To complete RTL support:

- Enable the Tailwind `rtl` variant in `tailwind.config.ts`:
  ```ts
  plugins: [require('tailwindcss-rtl')],
  ```
  Or use Tailwind's built-in `[dir=rtl]:` modifier (Tailwind v3.3+).

- Audit layout components for hardcoded directional styles. Replace with logical properties:
  ```
  pl-4   → ps-4   (padding-inline-start)
  mr-2   → me-2   (margin-inline-end)
  left-0 → start-0
  ```

- Load an RTL-compatible font for Arabic (e.g., Noto Sans Arabic). Add to `app/[locale]/layout.tsx`:
  ```tsx
  import { Noto_Sans_Arabic } from 'next/font/google';
  ```

### 5. Locale-aware amounts and dates

`lib/i18n.ts` already has `formatLocalizedCurrency` and `formatLocalizedDate`. After migrating to `next-intl`, replace direct calls with `next-intl`'s `useFormatter()`:

```ts
const format = useFormatter();
format.number(1234.56, { style: 'currency', currency: 'USD' }); // locale-aware
format.dateTime(date, { dateStyle: 'medium' });
```

For server components:
```ts
const format = await getFormatter({ locale });
```

---

## Data Model

No schema changes are needed. All i18n state lives in HTTP cookies (`NEXT_LOCALE`) and localStorage (`stellar_locale`).

---

## Failure Modes

| Scenario | Behaviour |
|---|---|
| Locale JSON fetch fails | Falls back to `en` (already implemented in `I18nProvider`) |
| Unsupported locale in URL | `next-intl` middleware redirects to default locale |
| Missing ICU key at runtime | `next-intl` returns the key string; never throws |
| RTL CSS not applied | `<html dir>` is set by middleware; CSS variables are inert for LTR locales |

---

## Test Plan

| Test | File | What to verify |
|---|---|---|
| RTL visual regression | `__tests__/dark-mode.test.ts` (extend) | Arabic locale sets `dir="rtl"` and `class="rtl"` on `<html>` |
| Missing-key check | CI step | Script exits 1 when a key is removed from `ar.json` |
| ICU plural | unit | `t('bounty.applicantCount', { count: 1 })` → `"1 applicant"` |
| Locale persistence | unit | Switching locale writes the cookie and is re-read on reload |
| Currency formatting | unit | `formatCurrency(1234.56, 'EUR', 'de')` → `"1.234,56 €"` |
| Server component translation | integration | A server component that calls `getTranslations()` renders translated text |

---

## Acceptance Criteria

- [ ] `next-intl` is installed and routes include the locale segment.
- [ ] ICU plural and select work in at least one component.
- [ ] CI fails when any locale file is missing a key.
- [ ] Arabic page sets `dir="rtl"` and layout does not overflow or truncate.
- [ ] Monetary amounts and dates use locale-aware formatting in all existing components that show them.
- [ ] CI is green (lint, type-check, tests).
- [ ] No new TODOs without a linked issue.

---

## Definition of Done

- Code merged to `main` with tests.
- Acceptance criteria above all checked.
- PR description explains the change, links this issue (`Closes #1774`), and lists anything deferred.
- Docs updated where user-facing or integrator-facing behaviour changed.

---

## Getting Started

```bash
git clone https://github.com/yosemite01/stellar-creator-portfolio.git
cd stellar-creator-portfolio
pnpm install
cp .env.example .env.local   # fill DATABASE_URL etc.
pnpm dev                     # Next.js on http://localhost:3000
pnpm typecheck && pnpm lint && pnpm test
```

Write a short design note in the PR (message catalog schema, routing strategy, migration plan for existing `useI18n()` call sites) before the bulk of the implementation.
