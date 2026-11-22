# Stellar Parity Shared Test Vectors

This directory contains canonical test vectors shared across the TypeScript frontend/client modules and the Rust API service.

## Purpose

Enforce strict validation and behavior parity between TypeScript and Rust implementations:
1. **SEP-23 Muxed Account Parsing**: StrKey Base32 decode, CRC16-XModem checksum validation, StrKey version byte verification (`0x60` for `MUXED_ACCOUNT_MED25519`), 64-bit muxed ID extraction, and base ed25519 G-address StrKey re-encoding (`0x30`).
2. **Asset Reserve Verification (Proof of Reserve)**: Precise 7-decimal place stroop scaling without floating-point inaccuracies, handling matching balances, mismatches across issuer/treasury accounts, and rejecting invalid precision (>7 decimals).

## Structure of `vectors.json`

- `muxed_accounts`:
  - `id`: unique vector identifier.
  - `description`: human-readable summary.
  - `input`: account string (G-address, M-address, or invalid representation).
  - `valid`: boolean indicating whether parsing should succeed.
  - `expected`: parsed fields (`base_account`, `muxed_id`, `is_muxed`, `analytics_id`).
  - `expected_error`: error enum/code when `valid` is false.
- `reserves_verification`:
  - `id`: unique vector identifier.
  - `description`: human-readable summary.
  - `declared`: declared reserves payload (`asset_code`, `asset_issuer`, `issuer_account`, `issuer_reserve`, `treasury_account`, `treasury_reserve`).
  - `observed`: observed balances (`issuer_balance`, `treasury_balance`).
  - `valid_input`: boolean indicating whether amounts are well-formed numbers.
  - `expected_valid`: boolean indicating whether reserves match.
  - `expected_mismatches`: array of mismatched account roles and values.
  - `expected_error`: error type when `valid_input` is false.

## Verification

- **TypeScript Suite**: `__tests__/stellar-parity.test.ts`
- **Rust Suite**: `backend/services/api/src/muxed.rs` & `backend/services/api/src/asset_verifier.rs`
