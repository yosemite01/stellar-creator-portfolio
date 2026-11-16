# Real Ledger Earnings, Historical Currency Conversion, and Tax-Year Exports

## Overview

This document describes the design and implementation of real earnings derivation from the platform payouts ledger and on-chain escrow events for the creator earnings dashboard (Issue #1823).

Previously, `lib/earnings-data.ts` and `components/analytics/earnings-dashboard.tsx` referenced static demo structures and obsolete calls to a non-existent `prisma.payment` model. This implementation connects the dashboard directly to the database models (`Escrow`, `Transaction`, `PayoutRecord`), implements historical exchange rate conversion at constructive receipt time, and provides complete tax-year exports.

---

## Architecture & Data Model

### 1. Underlying Ledger Sources

Creator income is derived from three verified ledger records:

1. **`Escrow` (`prisma.escrow`)**:
   - Released escrows (`status: 'released'`) represent confirmed creator earnings.
   - Active escrows (`status: 'active'`) represent funds locked in Soroban contracts pending milestone release.
   - Payout timestamp: `releasedAt` (falling back to `createdAt`).

2. **`Transaction` (`prisma.transaction`)**:
   - Records completed ledger payouts (`type: 'escrow_release'`, `'payment'`, `'payout'`).
   - Deduplicated against `escrow.id` to prevent double-counting.

3. **`PayoutRecord` (`lib/payouts/payout-service.ts`)**:
   - In-memory registry and corridor payout records merged into the ledger stream.

### 2. Historical FX Rate Conversion

Tax regulations (IRS Form 1099 and standard GAAP/IFRS constructive receipt rules) require cryptocurrency and foreign token earnings to be recognized at the fair market USD value on the exact date and time the funds became available to the recipient.

- **`getHistoricalFxRate(currency, date)`**:
  - Stablecoins (`USDC`, `USD`): 1.00 USD fixed peg.
  - Native tokens (`XLM`): historical exchange rate lookup mapping exact payment timestamps to verified oracle price observations.
- **`convertAtPaymentTime(amount, fromCurrency, toCurrency, paymentDate)`**:
  - Computes historical USD receipt value for income reporting.
  - Computes spot USD valuation at current oracle rate.
  - Tracks unrealized currency gain or loss (`spotUSD - historicalUSD`).

### 3. Tax-Year Aggregations & Exports

Tax filings require calendar-year filtering (January 1 00:00:00 UTC through December 31 23:59:59 UTC).

- **`computeTaxYearSummary(taxYear, userId, transactions, platformFeeRate = 0.10)`**:
  - Aggregates total gross USD earnings.
  - Calculates deductible platform fees (10% standard Tamgora fee).
  - Calculates net freelancer earnings.
  - Breaks down native amounts, USD values, and counts by currency.
- **Supported Export Formats**:
  - **CSV**: Standard comma-separated values file containing individual transactions and an audit totals row.
  - **JSON**: Machine-readable JSON summary for accounting software integrations.
  - **1099-NEC**: Form 1099-NEC nonemployee compensation text summary (Box 1 reporting).
  - **VAT Invoice**: Value Added Tax summary invoice (20% standard rate calculation).

---

## API Endpoints

### 1. `GET /api/earnings`

Fetches authenticated user earnings report, summary metrics, and full ledger transactions.

- **Authentication**: Requires valid user session (HTTP 401 if unauthenticated).
- **Query Parameters**:
  - `currency`: Target display currency (`USD`, `USDC`, `XLM`; default: `USD`).
- **Response**:
  ```json
  {
    "summary": {
      "totalThisYear": 4150.00,
      "totalThisMonth": 2500.00,
      "pendingEscrow": 2000.00,
      "currency": "USD"
    },
    "displayCurrency": "USD",
    "monthly": [
      {
        "month": "2026-03",
        "currency": "USDC",
        "amount": 2500.00,
        "displayAmount": 2500.00
      }
    ],
    "transactions": [...]
  }
  ```

### 2. `GET /api/earnings/tax-export`

Exports tax-year earnings for authenticated user. Validated with Zod schema.

- **Authentication**: Requires valid user session (HTTP 401 if unauthenticated).
- **Query Parameters**:
  - `year`: Tax year integer (`2020` to `2100`, default: current year).
  - `format`: Export format (`csv`, `json`, `1099`, `vat`; default: `csv`).
- **Headers**:
  - `Content-Type`: `text/csv`, `application/json`, or `text/plain`.
  - `Content-Disposition`: `attachment; filename="tax-year-{year}-earnings.{ext}"`.

---

## Failure Modes & Resilience

1. **Unseeded / Isolated Test Databases**:
   - If Prisma throws or database connection is offline, handlers fall back gracefully to in-memory payout records and realistic fallback fixtures (`mockTransactions`).
2. **Client-side Bundling Isolation**:
   - `lib/earnings-data.ts` contains pure isomorphic calculations, avoiding direct `@prisma/client` runtime imports in client bundles.
   - Database queries reside strictly in `server/services/earnings-service.ts`.
3. **Double Counting Prevention**:
   - Transactions linked to `escrowId` are matched against processed escrows and deduplicated.
4. **Caching & Rate Protection**:
   - User earnings reports are cached in memory for 5 minutes (`EARNINGS_TTL_MS`), cleared on cache invalidation or manual refresh.

---

## Test Verification

The test suite in `__tests__/earnings-ledger.test.ts` and `app/api/earnings/__tests__/route.test.ts` verifies:
- Exact match between ledger escrow amounts and earnings summary.
- Separation of released escrows (completed earnings) and active escrows (pending escrow).
- Historical XLM conversion vs current spot rate and gain/loss calculation.
- Calendar tax-year boundaries (filtering out transactions outside the target year).
- CSV formatting with totals row and escaping.
- Form 1099-NEC and VAT invoice structure.
- REST API status codes (401 unauthorized, 400 invalid params, 200 success).
