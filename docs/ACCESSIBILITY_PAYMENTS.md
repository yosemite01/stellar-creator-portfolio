# Accessibility: Wallet & Payment Flows (Issue #1773)

## Audit Summary & Architecture Note

### Issues Identified During Audit
1. **Focus trapping & restoration**: `CrossChainSwapModal` had `role="dialog"` and `aria-modal="true"` without a focus trap, Escape dismissal, or focus restoration to the launcher button. `useFocusTrap` in `lib/accessibility.tsx` did not filter disabled elements, move initial focus into the dialog, support `Escape`, or restore focus on close.
2. **ARIA live regions**: `LiveRegion` in `lib/accessibility.tsx` hardcoded `aria-live="polite"` even when `role="alert"` was passed. Payment flows (`CrossChainSwapModal`, `CrossChainSwapUI`, `Sep24Flow`, `Sep24PaymentForm`, `Sep24Timeline`, `EscrowReleaseButton`, `TokenGate`) lacked live announcements for asynchronous transaction states.
3. **Accessible labels & errors**:
   - `CrossChainSwapModal` used `<label>` elements not associated with form controls for chain selection and lacked accessible amount validation errors.
   - `CrossChainSwapUI` had an unlabeled amount `<input>` and an icon-only `<Copy />` button without an accessible name (WCAG 4.1.2 / axe `button-name` serious violation).
   - `Sep24PaymentForm` rendered field validation errors without linking them to inputs via `aria-describedby` or marking them `role="alert"`.
   - `TransactionLogTable` lacked `<caption>`, `scope="col"`, and descriptive accessible names for external explorer links.
4. **Wallet connection modal**: Header connected directly to Freighter without a keyboard-navigable wallet selector modal or screen-reader error recovery UI.

---

### Implemented Accessibility Guarantees (WCAG 2.2 AA)

| Capability | Implementation |
| :--- | :--- |
| **Focus Trap & Restoration** | `useFocusTrap` (`lib/accessibility.tsx`) moves initial focus inside dialogs, wraps `Tab`/`Shift+Tab` across visible enabled focusables only, handles `Escape`, and restores focus to the trigger element on close. |
| **Live Regions for Status & Errors** | `LiveRegion` uses `aria-live="polite"` for `role="status"` (progress/completion) and `aria-live="assertive"` for `role="alert"` (errors/network mismatch/expiry). |
| **Accessible Wallet Connect Modal** | `WalletConnectModal` (`components/wallet/wallet-connect-modal.tsx`) provides full `role="dialog"`, `aria-modal="true"`, `aria-labelledby`/`aria-describedby`, arrow-key wallet selection, live status updates, network mismatch alert, and assertive error alerts with Retry. |
| **Accessible Payment Modals & Forms** | `CrossChainSwapModal`, `CrossChainSwapUI`, `Sep24PaymentForm`, `Sep24Flow`, `Sep24Timeline`, `EscrowReleaseButton`, `SlippageToleranceControl`, and `TransactionLogTable` provide semantic radiogroups/fieldsets, `aria-describedby`-linked field errors, `aria-invalid`, `aria-busy`, `aria-hidden="true"` on decorative icons, and live status regions. |
| **WCAG Contrast Checking** | `computeContrastRatio()` and `AccessibilityChecker.checkContrast()` compute real WCAG 2.x relative luminance contrast ratios (`>= 4.5:1` normal text, `>= 3:1` large text). |

---

### Keyboard Interaction Map

- **Wallet Connect Modal (`Header` → `Connect Wallet`)**:
  - `Enter` / `Space`: Open wallet modal (sets `aria-expanded="true"`).
  - `Tab` / `Shift+Tab`: Cycle strictly within dialog controls.
  - `ArrowDown` / `ArrowUp` / `Home` / `End`: Move between Stellar wallet providers.
  - `Escape`: Dismiss modal and return focus to `Connect Wallet` button.
- **Cross-Chain Swap Modal (`Header` → `Bridge`)**:
  - `Enter` / `Space`: Open modal; select radio options; advance steps.
  - `Tab` / `Shift+Tab`: Cycle strictly within active step controls.
  - Step transitions automatically move focus to the updated step container and announce the new step via polite `LiveRegion`.
  - `Escape`: Dismiss modal and return focus to `Bridge` button.

---

### Verification & Testing

1. **Automated Unit & Accessibility Tests (Vitest + Testing Library)**:
   ```bash
   pnpm test __tests__/wallet-payment-a11y.test.tsx \
     components/wallet/connect-wallet-button.test.tsx \
     components/payments/escrow-release-button.test.tsx \
     components/payments/transaction-log-table.test.tsx
   ```
2. **Automated Playwright + `@axe-core/playwright` E2E Tests**:
   ```bash
   pnpm test:e2e -- e2e/a11y.spec.ts
   ```
   Verifies zero `serious` or `critical` WCAG 2.2 AA violations across primary pages, dashboards, the open Wallet Connect Modal, and multi-step Cross-Chain Swap Modal flows.
3. **Manual Screen-Reader Verification Checklist (VoiceOver / NVDA)**:
   - Open Wallet Connect Modal via keyboard → verify dialog title & description announced.
   - Trigger connection error → verify assertive alert read immediately and Retry button focusable.
   - Submit invalid amount in Swap / SEP-24 form → verify `aria-invalid` and error message read on field focus.
   - Advance Swap / SEP-24 status → verify polite live region announces status updates without stealing focus.
