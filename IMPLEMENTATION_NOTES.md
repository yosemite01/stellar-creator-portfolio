# Implementation Notes for Issues #784, #780, #787, #782

## Issue #784 - Admin User Management (COMPLETED)

**Status**: ✅ Implemented

**Files Created/Modified**:
- `lib/auth/config.ts` - NextAuth configuration with role-based session handling
- `app/api/auth/[...nextauth]/route.ts` - NextAuth API route handler
- `prisma/schema.prisma` - Added `suspendedAt` and `suspensionReason` to User model
- `prisma/migrations/20260626_add_user_suspension_tracking/migration.sql` - DB migration
- `app/admin/actions.ts` - Server actions for: changeUserRole, suspendUser, unsuspendUser, deleteUser
- `app/admin/users/page.tsx` - Integrated real database queries, added loading states

**Completed Features**:
- ✅ Searchable/filterable user table with pagination
- ✅ Role change dropdown (with ADMIN elevation confirmation)
- ✅ Self-promotion prevention (admin cannot self-promote)
- ✅ Ban/unban with required reason
- ✅ Session revocation on ban (deletes all sessions)
- ✅ Audit logging for all actions
- ✅ Bulk suspend/delete operations

**4-Eyes Principle Implementation**:
- Currently uses confirmation dialog before ADMIN elevation
- Enhanced implementation option: Add `AdminApprovalRequest` model to store pending approvals and require second admin confirmation before applying

---

## Issue #780 - Mobile Speech-to-Text Subtitling (PARTIALLY COMPLETED)

**Status**: 🟡 Partially Implemented - Core integration structure complete, STT library integration pending

**Files Created/Modified**:
- `mobile/src/hooks/useStreamSubtitles.ts` - Hook for managing subtitle state and translation
- `mobile/src/components/streaming/StreamViewerScreen.tsx` - Integrated subtitle display and CC button

**Completed Features**:
- ✅ CC toggle button with accessibility attributes
- ✅ Subtitle overlay at bottom of viewer
- ✅ Real-time subtitle buffering (3-second chunks)
- ✅ Integration with useChatTranslation for multi-language support
- ✅ Partial vs final transcription handling

**Pending Implementation**:
- ⏳ **STT Library Integration**: Need to add and integrate one of:
  - `expo-speech` (built-in iOS/Android support)
  - `@react-native-community/voice` (more flexible)
  - Or custom backend STT service integration

**Integration Steps**:
1. Install chosen STT library: `npm install expo-speech` (or alternative)
2. Implement `processAudioChunk` call in StreamViewerScreen when audio frame available
3. Connect to stream's audio track for real-time transcription
4. Set default latency target to <3s for good UX

**Language Support**:
- Framework in place via `useChatTranslation`
- Auto-detect language and translate subtitles
- Supports: Spanish (es), French (fr), German (de), Arabic (ar)

---

## Issue #787 - Escrow Yield Farming Slippage Protection

**Status**: 🔴 Not Yet Implemented

**Required Implementation**:

### 1. Add Error Enum to `backend/contracts/escrow/src/lib.rs`:
```rust
#[derive(Clone, Copy)]
pub enum EscrowError {
    Unauthorized = 1,
    InvalidEscrow = 2,
    InvalidStatus = 3,
    SlippageExceeded = 4,  // New error variant
}

impl From<EscrowError> for Result<(), EscrowError> {
    fn from(e: EscrowError) -> Self {
        Err(e)
    }
}
```

### 2. Add `deposit_to_yield` Function:
```rust
pub fn deposit_to_yield(
    env: Env,
    escrow_id: u64,
    amount: i128,
    min_shares: i128,
) -> i128 {
    // 1. Verify escrow exists and is active
    // 2. Call yield protocol deposit
    // 3. Check shares >= min_shares
    // 4. If shares < min_shares, panic_with_error!(&env, EscrowError::SlippageExceeded)
    // 5. Store shares and return
}
```

### 3. Add Default Slippage Configuration:
- Default max slippage: 1% (100 basis points)
- Make it governance-configurable via `configure_slippage()` function
- Store in YieldConfig with field: `max_slippage_bps: u32`

### 4. Frontend Integration:
- Add slippage tolerance control to yield deposit UI
- Show expected shares vs actual shares before depositing
- Calculate recommended min_shares = expected_shares * (1 - max_slippage_bps / 10_000)

**Tests Required**:
- Normal deposit passes when slippage within tolerance
- Deposit reverts with SlippageExceeded when shares < min_shares
- Edge case: exact slippage boundary
- Configuration update works correctly

---

## Issue #782 - OCR-based KYC Document Verification

**Status**: 🔴 Not Yet Implemented

**Required Implementation**:

### 1. Extend Prisma Schema:
```prisma
model KYCSubmission {
  id                 String   @id @default(cuid())
  userId             String   @unique
  user               User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  // Document metadata
  documentType       String   // "passport", "driver_license", "national_id"
  uploadedAt         DateTime @default(now())
  expiresAt          DateTime @default(now() + 90 days)

  // Encrypted extracted data
  encryptedName      String   // Encrypted with AWS KMS
  encryptedDOB       String
  encryptedIdNumber  String

  // Verification flow
  status             String   @default("pending")  // "pending", "approved", "rejected"
  adminReviewedBy    String?
  adminReviewedAt    DateTime?
  rejectionReason    String?

  // On-chain verification
  verifiedOnChain    Boolean  @default(false)
  txHash             String?  @unique

  @@index([userId])
  @@index([status])
  @@index([expiresAt])
}
```

### 2. Implement OCR Service:
Create `mobile/src/services/OCRKYCService.ts` with:
- `uploadDocument(file, documentType)` - Upload to S3
- `extractData(imageUrl)` - Call AWS Textract or Tesseract.js
- `encryptAndStore(extractedData)` - Encrypt with AWS KMS before storing
- `cleanupExpired()` - Cron job to delete after 90 days (GDPR)

**Provider Options**:
- **AWS Textract** (Recommended): More accurate, native integration
- **Tesseract.js**: Open-source, runs client-side

### 3. Admin Review Page Integration:
Add to `app/admin/users/page.tsx`:
- KYC submissions list/tab
- Approve/Reject buttons with reason field
- Shows only extracted name (other fields stay encrypted)
- On approval: call identity contract `verify()` on-chain

### 4. Identity Contract Integration:
Call `backend/contracts/identity/src/lib.rs` function:
```rust
pub fn verify_kyc(env: Env, user_id: String, kyc_submission_id: String) -> bool {
    // Verify KYC status in Prisma
    // Mark user as verified in CreatorProfile
    // Emit VerifiedKYC event
}
```

### 5. Privacy & Security:
- Encrypt at rest: AWS KMS key rotation every 90 days
- Delete after 90 days (GDPR compliance)
- Only admin can view extracted data
- Audit log every access
- No raw PII in logs/database

**Tests Required**:
- Document upload and processing
- OCR extraction accuracy
- Encryption/decryption
- Admin approve/reject workflow
- On-chain verify call
- Expiry cleanup task
- GDPR deletion confirmation

---

## Next Steps Priority

1. **Issue #784**: ✅ Ready for testing - needs: unit tests for 4-eyes, self-promotion prevention
2. **Issue #780**: 🟡 Add STT library integration (~2-3 hours)
3. **Issue #787**: 🔴 Implement Soroban functions (~4-5 hours)
4. **Issue #782**: 🔴 Full OCR + admin workflow (~6-8 hours)

**Testing Infrastructure**:
- Mobile tests: Existing test setup in `mobile/__tests__/`
- Contract tests: Use soroban-sdk test utilities
- E2E: Admin pages test with mock data

