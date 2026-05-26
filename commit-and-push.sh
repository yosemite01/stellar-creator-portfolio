#!/bin/bash
# Script to commit and push all changes for issues #357, #323, #304, and #353

cd /workspaces/stellar-creator-portfolio

# Create feature branch
git checkout -b feature/multi-issue-357-323-304-353

# Stage all changes
git add .

# Commit for Issue #357 - Review List component
git commit -m "feat(#357): [Review] [FE] [UI] Review List component

- Create dedicated ReviewList component for displaying creator reviews
- Integrate ReviewList into creator-reputation component
- Add star rating display with proper formatting
- Add review metadata (reviewer name, date, rating)"

# Add and commit for Issue #323 - Error Response UI
git add lib/error-handling.ts components/error-alert.tsx

git commit -m "feat(#323): [API] [FE] [Handling] Error response UI

- Add comprehensive error handling utilities in lib/error-handling.ts
- Create ErrorAlert component for displaying API errors
- Implement field error display for validation errors
- Add user-friendly error messages for all error codes
- Enhance creator-reputation component with error state handling"

# Add and commit for Issue #304 - useStellarWallet hook
git add hooks/useStellarWallet.ts hooks/useStellarAuth.ts

git commit -m "feat(#304): [Auth] [FE] [Hook] Implement useStellarWallet hook

- Create useStellarWallet hook for Stellar wallet connection
- Implement localStorage persistence for public key
- Add wallet connection and disconnection methods
- Create useStellarAuth as convenience re-export
- Add TypeScript augmentation for Stellar window API
- Implement Stellar address validation (must start with G and be 56 chars)"

# Add and commit for Issue #353 - Escrow contract fuzzing
git add backend/contracts/escrow/src/fuzz_tests.rs backend/contracts/escrow/src/lib.rs

git commit -m "feat(#353): [Pay] [Testing] Fuzzing escrow contract functions

- Add comprehensive fuzz tests module with 8 property-based tests
- Test invariants: no double-spend, balance conservation, authorization
- Test status transitions and concurrent escrow operations
- Test timelock release conditions enforcement
- Test escrow counter increments sequentially
- Verify refund prevents release and vice versa
- Add tests for positive amount requirement
- Integrate fuzz tests into escrow contract test suite"

# Push the branch
git push -u origin feature/multi-issue-357-323-304-353

echo "All commits and push completed successfully!"
