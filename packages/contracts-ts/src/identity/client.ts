import {VerificationTier, KycLevel, SocialProof, KycIssuer, KycError, KycCommitment, KycAttestation, PendingUpgrade} from './types';
import {Result, Spec, AssembledTransaction, Client as ContractClient, ClientOptions as ContractClientOptions, MethodOptions} from '@stellar/stellar-sdk/contract';
import {Address} from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';

export interface Client {
  /**
   * Retrieve the tier attestation for a creator.
   * Returns None variant attestation if not yet set or revoked.
   */
  get_tier({ owner }: { owner: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<VerificationTier>>;
  /**
   * Attest a creator's verification tier on-chain. Admin-only.
   *
   * Previously any address could call this for any owner (the attester
   * only had to sign for itself), so trust badges could be self-issued.
   * The attester must now be the stored platform admin.
   */
  set_tier({ attester, owner, tier }: { attester: string | Address; owner: string | Address; tier: VerificationTier }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  /**
   * Canonical KYC read: checks a presented opening `(level, salt)`.
   * True only if an attestation exists, has not expired, its issuer is not
   * revoked, it was signed by a key version the issuer still accepts,
   * `sha256(level || salt)` matches its commitment, and
   * `level >= required_level`.
   */
  check_kyc({ user, required_level, level, salt }: { user: string | Address; required_level: KycLevel; level: KycLevel; salt: Buffer }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  get_proof({ owner, domain_hash }: { owner: string | Address; domain_hash: Buffer }, options?: MethodOptions): Promise<AssembledTransaction<SocialProof>>;
  has_proof({ owner, domain_hash }: { owner: string | Address; domain_hash: Buffer }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  /**
   * Admin-issued KYC commitment (issuer `ADMIN_ISSUER_ID`, one-year
   * validity). Overwrites any existing attestation.
   *
   * Event: `(kyc, attested)` → `(user, commitment)`.
   */
  attest_kyc({ admin, user, commitment }: { admin: string | Address; user: string | Address; commitment: Buffer }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  get_issuer({ issuer_id }: { issuer_id: number }, options?: MethodOptions): Promise<AssembledTransaction<Result<KycIssuer, KycError>>>;
  initialize({ admin }: { admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Revoke a user's KYC attestation (and any legacy plaintext record).
   * Admin-only. Afterwards `check_kyc` returns `false` for every opening
   * and `get_kyc_attestation` returns `None`. To cut off every attestation
   * from one issuer at once, use `revoke_issuer`.
   *
   * Event: `(kyc, revoked)` → `user`.
   */
  revoke_kyc({ admin, user }: { admin: string | Address; user: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Record a KYC commitment following off-chain document review (see
   * `KYCSubmission` in the application database). Admin-only (issuer
   * `ADMIN_ISSUER_ID`, one year). The event carries the hashed
   * `kyc_submission_id` so activity can be traced to the reviewed record.
   * Also used by the re-attestation job.
   *
   * Event: `(kyc, verified)` → `(user, kyc_submission_id)`.
   */
  verify_kyc({ admin, user, commitment, kyc_submission_id }: { admin: string | Address; user: string | Address; commitment: Buffer; kyc_submission_id: Buffer }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  proof_count({ owner }: { owner: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<number>>;
  /**
   * Revoke a creator's tier attestation. Admin-only. Afterwards `get_tier`
   * returns `VerificationTier::None`. Emits `(identity, tier_rev)` →
   * `(owner, revoked_tier)`.
   */
  revoke_tier({ admin, owner }: { admin: string | Address; owner: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Accept a nomination (step 2 of 2). Must be signed by the nominee.
   * Emits `(admin, accepted)`.
   */
  accept_admin({ new_admin }: { new_admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  revoke_proof({ owner, domain_hash }: { owner: string | Address; domain_hash: Buffer }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  /**
   * Submit a cryptographic proof linking an address to a social domain.
   * Verifies the Ed25519 signature of `domain_hash` under `public_key`
   * natively via `env.crypto().ed25519_verify`.
   *
   * # Arguments
   * * `owner` - The Address submitting the proof (must authenticate)
   * * `domain_hash` - The 32-byte hash of the social domain/handle
   * * `public_key` - The Ed25519 public key used for signature verification
   * * `proof` - The Ed25519 signature proof (64 bytes)
   *
   * # Returns
   * bool - true on successful verification
   *
   * # Errors
   * Panics with message if:
   * - `owner` does not authenticate the call
   * - Proof is already verified for this owner+domain_hash pair
   * - Ed25519 signature verification fails (invalid signature)
   */
  submit_proof({ owner, domain_hash, public_key, proof }: { owner: string | Address; domain_hash: Buffer; public_key: Buffer; proof: Buffer }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  /**
   * Nominate a new admin (step 1 of 2). Admin-only. Emits `(admin, proposed)`.
   */
  propose_admin({ admin, new_admin }: { admin: string | Address; new_admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Revoke an issuer. Admin-only. Every attestation it wrote stops
   * validating in O(1); none are touched individually. Irreversible:
   * register a new issuer instead. Emits `(kyc, iss_rev)` → `id`.
   */
  revoke_issuer({ admin, issuer_id }: { admin: string | Address; issuer_id: number }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, KycError>>>;
  /**
   * Withdraw the pending upgrade. Admin-only. Emits `(upgrade, cancelled)`.
   */
  cancel_upgrade({ admin }: { admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Whether a legacy plaintext KYC record still exists for `user`.
   */
  has_legacy_kyc({ user }: { user: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  /**
   * Apply the pending upgrade once its timelock has elapsed. Admin-only.
   * Emits `(contract, upgraded)`.
   */
  execute_upgrade({ admin }: { admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Propose a WASM upgrade. Admin-only. Returns the ledger timestamp after
   * which `execute_upgrade` may be called (now + 48h). Emits
   * `(upgrade, proposed)`.
   */
  propose_upgrade({ admin, new_wasm_hash }: { admin: string | Address; new_wasm_hash: Buffer }, options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  /**
   * Register a third-party KYC issuer whose current key is `signer`.
   * Admin-only. Returns the new issuer id (ids start at 1; 0 is the
   * platform admin). Emits `(kyc, iss_reg)` → `(id, signer)`.
   */
  register_issuer({ admin, signer }: { admin: string | Address; signer: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<number, KycError>>>;
  /**
   * Delete a pre-#1718 plaintext attestation for `user`. Admin-only.
   * Returns `false` if there was nothing to delete. Ledger history still
   * holds the old value; this only removes it from current state.
   *
   * Event: `(kyc, purged)` → `user`.
   */
  purge_legacy_kyc({ admin, user }: { admin: string | Address; user: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  /**
   * The nominated-but-not-yet-accepted admin, if any.
   */
  get_pending_admin(options?: MethodOptions): Promise<AssembledTransaction<string | null>>;
  /**
   * Commitment written by a registered issuer, signed by its current
   * key. `ttl_secs` must be in `1..=MAX_KYC_TTL_SECS`. Emits
   * `(kyc, iss_att)` → `(user, commitment, issuer_id, expires_at)`.
   */
  issuer_attest_kyc({ signer, issuer_id, user, commitment, ttl_secs }: { signer: string | Address; issuer_id: number; user: string | Address; commitment: Buffer; ttl_secs: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, KycError>>>;
  /**
   * Rotate an issuer's key. Callable by the admin or the issuer's current
   * signer. With `invalidate_previous`, every attestation signed by an
   * older key stops validating immediately (O(1) — the compromised-key
   * response). Emits `(kyc, iss_rot)` → `(id, key_version, invalidate_previous)`.
   */
  rotate_issuer_key({ caller, issuer_id, new_signer, invalidate_previous }: { caller: string | Address; issuer_id: number; new_signer: string | Address; invalidate_previous: boolean }, options?: MethodOptions): Promise<AssembledTransaction<Result<number, KycError>>>;
  /**
   * The stored commitment for `user`, if any. Reveals no level.
   */
  get_kyc_commitment({ user }: { user: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<KycCommitment | null>>;
  /**
   * The stored attestation, valid or not. Reveals no level; use
   * `check_kyc` for decisions.
   */
  get_kyc_attestation({ user }: { user: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<KycAttestation | null>>;
  /**
   * The upgrade currently waiting out its timelock, if any.
   */
  get_pending_upgrade(options?: MethodOptions): Promise<AssembledTransaction<PendingUpgrade | null>>;
  /**
   * Withdraw a pending admin nomination. Admin-only. Emits `(admin, cancelled)`.
   */
  cancel_admin_transfer({ admin }: { admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Compute the commitment for an opening. Read-only helper so clients can
   * check their encoding matches the contract's.
   */
  compute_kyc_commitment({ level, salt }: { level: KycLevel; salt: Buffer }, options?: MethodOptions): Promise<AssembledTransaction<Buffer>>;
}

export class Client extends ContractClient {
  constructor(public readonly options: ContractClientOptions) {
    super(
      new Spec(["AAAABAAAAHlUeXBlZCBlcnJvcnMgZm9yIHRoZSBLWUMgaXNzdWVyIHJlZ2lzdHJ5ICgjMTcxNykuIFN1cmZhY2Ugb24tY2hhaW4gYXMKYEVycm9yKENvbnRyYWN0LCAjbilgOyBuZXZlciByZW51bWJlciwgb25seSBhcHBlbmQuAAAAAAAAAAAAAAhLeWNFcnJvcgAAAAYAAAAAAAAADk5vdEluaXRpYWxpemVkAAAAAABlAAAAAAAAAAxVbmF1dGhvcml6ZWQAAABmAAAAAAAAAA5Jc3N1ZXJOb3RGb3VuZAAAAAAAZwAAAAAAAAANSXNzdWVyUmV2b2tlZAAAAAAAAGgAAAAAAAAACkludmFsaWRUdGwAAAAAAGkAAAAAAAAAE0F0dGVzdGF0aW9uTm90Rm91bmQAAAAAag==", "AAAAAwAAAAAAAAAAAAAACEt5Y0xldmVsAAAAAwAAAAAAAAAFQmFzaWMAAAAAAAAAAAAAAAAAAAhFbmhhbmNlZAAAAAEAAAAAAAAADUluc3RpdHV0aW9uYWwAAAAAAAAC", "AAAAAQAAAOpBIHJlZ2lzdGVyZWQgS1lDIGlzc3Vlci4gYHNpZ25lcmAgaXMgdGhlIGlzc3VlcidzIGN1cnJlbnQga2V5OyByb3RhdGluZwppdCBidW1wcyBga2V5X3ZlcnNpb25gLiBBdHRlc3RhdGlvbnMgc2lnbmVkIGJ5IGEga2V5IG9sZGVyIHRoYW4KYG1pbl9rZXlfdmVyc2lvbmAgYXJlIGludmFsaWQsIGFuZCBhIGByZXZva2VkYCBpc3N1ZXIgaW52YWxpZGF0ZXMgZXZlcnkKYXR0ZXN0YXRpb24gaXQgZXZlciB3cm90ZS4AAAAAAAAAAAAJS3ljSXNzdWVyAAAAAAAABgAAAAAAAAACaWQAAAAAAAQAAAAAAAAAC2tleV92ZXJzaW9uAAAAAAQAAAAAAAAAD21pbl9rZXlfdmVyc2lvbgAAAAAEAAAAAAAAAA1yZWdpc3RlcmVkX2F0AAAAAAAABgAAAAAAAAAHcmV2b2tlZAAAAAABAAAAAAAAAAZzaWduZXIAAAAAABM=", "AAAAAQAAAAAAAAAAAAAAC1NvY2lhbFByb29mAAAAAAUAAAAAAAAAC2RvbWFpbl9oYXNoAAAAA+4AAAAgAAAAAAAAAAVvd25lcgAAAAAAABMAAAAAAAAABXByb29mAAAAAAAD7gAAAEAAAAAAAAAADHN1Ym1pdHRlZF9hdAAAAAYAAAAAAAAACHZlcmlmaWVkAAAAAQ==", "AAAAAQAAAEJDb21taXRtZW50IHZpZXcgb2YgYSB1c2VyJ3MgYXR0ZXN0YXRpb24gKCMxNzE4KS4gUmV2ZWFscyBubyBsZXZlbC4AAAAAAAAAAAANS3ljQ29tbWl0bWVudAAAAAAAAAMAAAAAAAAAC2F0dGVzdGVkX2F0AAAAAAYAAAAAAAAACmNvbW1pdG1lbnQAAAAAA+4AAAAgAAAAAAAAAApleHBpcmVzX2F0AAAAAAAG", "AAAAAQAAAV5LWUMgYXR0ZXN0YXRpb24gKHNjaGVtYSB2MykuIEVhY2ggYXR0ZXN0YXRpb24gbmFtZXMgdGhlIGlzc3VlciB0aGF0Cndyb3RlIGl0IGFuZCB0aGUgaXNzdWVyIGtleSB2ZXJzaW9uIHRoYXQgc2lnbmVkIGl0LCBzbyBhbiBpc3N1ZXIgKG9yIG9uZQpvZiBpdHMgY29tcHJvbWlzZWQga2V5cykgY2FuIGJlIGN1dCBvZmYgaW4gTygxKSB3aXRob3V0IHRvdWNoaW5nCmluZGl2aWR1YWwgYXR0ZXN0YXRpb25zICgjMTcxNykuIENvbnRyYWN0IHN0b3JhZ2UgaXMgcHVibGljLCBzbyBvbmx5IGEKc2FsdGVkIGNvbW1pdG1lbnQgdG8gdGhlIGxldmVsIGlzIHN0b3JlZCwgbmV2ZXIgdGhlIGxldmVsIGl0c2VsZiAoIzE3MTgpLgAAAAAAAAAAAA5LeWNBdHRlc3RhdGlvbgAAAAAABwAAADhgc2hhMjU2KFtsZXZlbCBhcyB1OF0gfHwgc2FsdClgOyBzZWUgW2BreWNfY29tbWl0bWVudGBdLgAAAApjb21taXRtZW50AAAAAAPuAAAAIAAAAAAAAAAKZXhwaXJlc19hdAAAAAAABgAAAAAAAAAJaXNzdWVkX2F0AAAAAAAABgAAAAAAAAAJaXNzdWVyX2lkAAAAAAAABAAAAAAAAAALa2V5X3ZlcnNpb24AAAAABAAAAAAAAAAOc2NoZW1hX3ZlcnNpb24AAAAAAAQAAAAAAAAABHVzZXIAAAAT", "AAAAAgAAAH1Pbi1jaGFpbiB0aWVyIGxldmVscyBtaXJyb3JpbmcgdGhlIERCIGVudW0uClN0b3JlZCBhcyB1MzIgZm9yIGNvbXBhY3QgU29yb2JhbiBzdG9yYWdlLgpOT05FPTAgIFZFUklGSUVEPTEgIFRSVVNURUQ9MiAgRUxJVEU9MwAAAAAAAAAAAAAQVmVyaWZpY2F0aW9uVGllcgAAAAQAAAAAAAAAAAAAAAROb25lAAAAAAAAAAAAAAAIVmVyaWZpZWQAAAAAAAAAAAAAAAdUcnVzdGVkAAAAAAAAAAAAAAAABUVsaXRlAAAA", "AAAAAAAAAGhSZXRyaWV2ZSB0aGUgdGllciBhdHRlc3RhdGlvbiBmb3IgYSBjcmVhdG9yLgpSZXR1cm5zIE5vbmUgdmFyaWFudCBhdHRlc3RhdGlvbiBpZiBub3QgeWV0IHNldCBvciByZXZva2VkLgAAAAhnZXRfdGllcgAAAAEAAAAAAAAABW93bmVyAAAAAAAAEwAAAAEAAAfQAAAAEFZlcmlmaWNhdGlvblRpZXI=", "AAAAAAAAAPZBdHRlc3QgYSBjcmVhdG9yJ3MgdmVyaWZpY2F0aW9uIHRpZXIgb24tY2hhaW4uIEFkbWluLW9ubHkuCgpQcmV2aW91c2x5IGFueSBhZGRyZXNzIGNvdWxkIGNhbGwgdGhpcyBmb3IgYW55IG93bmVyICh0aGUgYXR0ZXN0ZXIKb25seSBoYWQgdG8gc2lnbiBmb3IgaXRzZWxmKSwgc28gdHJ1c3QgYmFkZ2VzIGNvdWxkIGJlIHNlbGYtaXNzdWVkLgpUaGUgYXR0ZXN0ZXIgbXVzdCBub3cgYmUgdGhlIHN0b3JlZCBwbGF0Zm9ybSBhZG1pbi4AAAAAAAhzZXRfdGllcgAAAAMAAAAAAAAACGF0dGVzdGVyAAAAEwAAAAAAAAAFb3duZXIAAAAAAAATAAAAAAAAAAR0aWVyAAAH0AAAABBWZXJpZmljYXRpb25UaWVyAAAAAQAAAAE=", "AAAAAAAAARdDYW5vbmljYWwgS1lDIHJlYWQ6IGNoZWNrcyBhIHByZXNlbnRlZCBvcGVuaW5nIGAobGV2ZWwsIHNhbHQpYC4KVHJ1ZSBvbmx5IGlmIGFuIGF0dGVzdGF0aW9uIGV4aXN0cywgaGFzIG5vdCBleHBpcmVkLCBpdHMgaXNzdWVyIGlzIG5vdApyZXZva2VkLCBpdCB3YXMgc2lnbmVkIGJ5IGEga2V5IHZlcnNpb24gdGhlIGlzc3VlciBzdGlsbCBhY2NlcHRzLApgc2hhMjU2KGxldmVsIHx8IHNhbHQpYCBtYXRjaGVzIGl0cyBjb21taXRtZW50LCBhbmQKYGxldmVsID49IHJlcXVpcmVkX2xldmVsYC4AAAAACWNoZWNrX2t5YwAAAAAAAAQAAAAAAAAABHVzZXIAAAATAAAAAAAAAA5yZXF1aXJlZF9sZXZlbAAAAAAH0AAAAAhLeWNMZXZlbAAAAAAAAAAFbGV2ZWwAAAAAAAfQAAAACEt5Y0xldmVsAAAAAAAAAARzYWx0AAAD7gAAACAAAAABAAAAAQ==", "AAAAAAAAAAAAAAAJZ2V0X3Byb29mAAAAAAAAAgAAAAAAAAAFb3duZXIAAAAAAAATAAAAAAAAAAtkb21haW5faGFzaAAAAAPuAAAAIAAAAAEAAAfQAAAAC1NvY2lhbFByb29mAA==", "AAAAAAAAAAAAAAAJaGFzX3Byb29mAAAAAAAAAgAAAAAAAAAFb3duZXIAAAAAAAATAAAAAAAAAAtkb21haW5faGFzaAAAAAPuAAAAIAAAAAEAAAAB", "AAAAAAAAAKNBZG1pbi1pc3N1ZWQgS1lDIGNvbW1pdG1lbnQgKGlzc3VlciBgQURNSU5fSVNTVUVSX0lEYCwgb25lLXllYXIKdmFsaWRpdHkpLiBPdmVyd3JpdGVzIGFueSBleGlzdGluZyBhdHRlc3RhdGlvbi4KCkV2ZW50OiBgKGt5YywgYXR0ZXN0ZWQpYCDihpIgYCh1c2VyLCBjb21taXRtZW50KWAuAAAAAAphdHRlc3Rfa3ljAAAAAAADAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAABHVzZXIAAAATAAAAAAAAAApjb21taXRtZW50AAAAAAPuAAAAIAAAAAA=", "AAAAAAAAAAAAAAAKZ2V0X2lzc3VlcgAAAAAAAQAAAAAAAAAJaXNzdWVyX2lkAAAAAAAABAAAAAEAAAPpAAAH0AAAAAlLeWNJc3N1ZXIAAAAAAAfQAAAACEt5Y0Vycm9y", "AAAAAAAAAAAAAAAKaW5pdGlhbGl6ZQAAAAAAAQAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAA==", "AAAAAAAAASFSZXZva2UgYSB1c2VyJ3MgS1lDIGF0dGVzdGF0aW9uIChhbmQgYW55IGxlZ2FjeSBwbGFpbnRleHQgcmVjb3JkKS4KQWRtaW4tb25seS4gQWZ0ZXJ3YXJkcyBgY2hlY2tfa3ljYCByZXR1cm5zIGBmYWxzZWAgZm9yIGV2ZXJ5IG9wZW5pbmcKYW5kIGBnZXRfa3ljX2F0dGVzdGF0aW9uYCByZXR1cm5zIGBOb25lYC4gVG8gY3V0IG9mZiBldmVyeSBhdHRlc3RhdGlvbgpmcm9tIG9uZSBpc3N1ZXIgYXQgb25jZSwgdXNlIGByZXZva2VfaXNzdWVyYC4KCkV2ZW50OiBgKGt5YywgcmV2b2tlZClgIOKGkiBgdXNlcmAuAAAAAAAACnJldm9rZV9reWMAAAAAAAIAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAEdXNlcgAAABMAAAAA", "AAAAAAAAAWJSZWNvcmQgYSBLWUMgY29tbWl0bWVudCBmb2xsb3dpbmcgb2ZmLWNoYWluIGRvY3VtZW50IHJldmlldyAoc2VlCmBLWUNTdWJtaXNzaW9uYCBpbiB0aGUgYXBwbGljYXRpb24gZGF0YWJhc2UpLiBBZG1pbi1vbmx5IChpc3N1ZXIKYEFETUlOX0lTU1VFUl9JRGAsIG9uZSB5ZWFyKS4gVGhlIGV2ZW50IGNhcnJpZXMgdGhlIGhhc2hlZApga3ljX3N1Ym1pc3Npb25faWRgIHNvIGFjdGl2aXR5IGNhbiBiZSB0cmFjZWQgdG8gdGhlIHJldmlld2VkIHJlY29yZC4KQWxzbyB1c2VkIGJ5IHRoZSByZS1hdHRlc3RhdGlvbiBqb2IuCgpFdmVudDogYChreWMsIHZlcmlmaWVkKWAg4oaSIGAodXNlciwga3ljX3N1Ym1pc3Npb25faWQpYC4AAAAAAAp2ZXJpZnlfa3ljAAAAAAAEAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAABHVzZXIAAAATAAAAAAAAAApjb21taXRtZW50AAAAAAPuAAAAIAAAAAAAAAARa3ljX3N1Ym1pc3Npb25faWQAAAAAAAPuAAAAIAAAAAEAAAAB", "AAAAAAAAAAAAAAALcHJvb2ZfY291bnQAAAAAAQAAAAAAAAAFb3duZXIAAAAAAAATAAAAAQAAAAQ=", "AAAAAAAAAKJSZXZva2UgYSBjcmVhdG9yJ3MgdGllciBhdHRlc3RhdGlvbi4gQWRtaW4tb25seS4gQWZ0ZXJ3YXJkcyBgZ2V0X3RpZXJgCnJldHVybnMgYFZlcmlmaWNhdGlvblRpZXI6Ok5vbmVgLiBFbWl0cyBgKGlkZW50aXR5LCB0aWVyX3JldilgIOKGkgpgKG93bmVyLCByZXZva2VkX3RpZXIpYC4AAAAAAAtyZXZva2VfdGllcgAAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAABW93bmVyAAAAAAAAEwAAAAA=", "AAAAAAAAAFxBY2NlcHQgYSBub21pbmF0aW9uIChzdGVwIDIgb2YgMikuIE11c3QgYmUgc2lnbmVkIGJ5IHRoZSBub21pbmVlLgpFbWl0cyBgKGFkbWluLCBhY2NlcHRlZClgLgAAAAxhY2NlcHRfYWRtaW4AAAABAAAAAAAAAAluZXdfYWRtaW4AAAAAAAATAAAAAA==", "AAAAAAAAAAAAAAAMcmV2b2tlX3Byb29mAAAAAgAAAAAAAAAFb3duZXIAAAAAAAATAAAAAAAAAAtkb21haW5faGFzaAAAAAPuAAAAIAAAAAEAAAAB", "AAAAAAAAAq5TdWJtaXQgYSBjcnlwdG9ncmFwaGljIHByb29mIGxpbmtpbmcgYW4gYWRkcmVzcyB0byBhIHNvY2lhbCBkb21haW4uClZlcmlmaWVzIHRoZSBFZDI1NTE5IHNpZ25hdHVyZSBvZiBgZG9tYWluX2hhc2hgIHVuZGVyIGBwdWJsaWNfa2V5YApuYXRpdmVseSB2aWEgYGVudi5jcnlwdG8oKS5lZDI1NTE5X3ZlcmlmeWAuCgojIEFyZ3VtZW50cwoqIGBvd25lcmAgLSBUaGUgQWRkcmVzcyBzdWJtaXR0aW5nIHRoZSBwcm9vZiAobXVzdCBhdXRoZW50aWNhdGUpCiogYGRvbWFpbl9oYXNoYCAtIFRoZSAzMi1ieXRlIGhhc2ggb2YgdGhlIHNvY2lhbCBkb21haW4vaGFuZGxlCiogYHB1YmxpY19rZXlgIC0gVGhlIEVkMjU1MTkgcHVibGljIGtleSB1c2VkIGZvciBzaWduYXR1cmUgdmVyaWZpY2F0aW9uCiogYHByb29mYCAtIFRoZSBFZDI1NTE5IHNpZ25hdHVyZSBwcm9vZiAoNjQgYnl0ZXMpCgojIFJldHVybnMKYm9vbCAtIHRydWUgb24gc3VjY2Vzc2Z1bCB2ZXJpZmljYXRpb24KCiMgRXJyb3JzClBhbmljcyB3aXRoIG1lc3NhZ2UgaWY6Ci0gYG93bmVyYCBkb2VzIG5vdCBhdXRoZW50aWNhdGUgdGhlIGNhbGwKLSBQcm9vZiBpcyBhbHJlYWR5IHZlcmlmaWVkIGZvciB0aGlzIG93bmVyK2RvbWFpbl9oYXNoIHBhaXIKLSBFZDI1NTE5IHNpZ25hdHVyZSB2ZXJpZmljYXRpb24gZmFpbHMgKGludmFsaWQgc2lnbmF0dXJlKQAAAAAADHN1Ym1pdF9wcm9vZgAAAAQAAAAAAAAABW93bmVyAAAAAAAAEwAAAAAAAAALZG9tYWluX2hhc2gAAAAD7gAAACAAAAAAAAAACnB1YmxpY19rZXkAAAAAA+4AAAAgAAAAAAAAAAVwcm9vZgAAAAAAA+4AAABAAAAAAQAAAAE=", "AAAAAAAAAEpOb21pbmF0ZSBhIG5ldyBhZG1pbiAoc3RlcCAxIG9mIDIpLiBBZG1pbi1vbmx5LiBFbWl0cyBgKGFkbWluLCBwcm9wb3NlZClgLgAAAAAADXByb3Bvc2VfYWRtaW4AAAAAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAACW5ld19hZG1pbgAAAAAAABMAAAAA", "AAAAAAAAAL9SZXZva2UgYW4gaXNzdWVyLiBBZG1pbi1vbmx5LiBFdmVyeSBhdHRlc3RhdGlvbiBpdCB3cm90ZSBzdG9wcwp2YWxpZGF0aW5nIGluIE8oMSk7IG5vbmUgYXJlIHRvdWNoZWQgaW5kaXZpZHVhbGx5LiBJcnJldmVyc2libGU6CnJlZ2lzdGVyIGEgbmV3IGlzc3VlciBpbnN0ZWFkLiBFbWl0cyBgKGt5YywgaXNzX3JldilgIOKGkiBgaWRgLgAAAAANcmV2b2tlX2lzc3VlcgAAAAAAAAIAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAJaXNzdWVyX2lkAAAAAAAABAAAAAEAAAPpAAAAAgAAB9AAAAAIS3ljRXJyb3I=", "AAAAAAAAAEdXaXRoZHJhdyB0aGUgcGVuZGluZyB1cGdyYWRlLiBBZG1pbi1vbmx5LiBFbWl0cyBgKHVwZ3JhZGUsIGNhbmNlbGxlZClgLgAAAAAOY2FuY2VsX3VwZ3JhZGUAAAAAAAEAAAAAAAAABWFkbWluAAAAAAAAEwAAAAA=", "AAAAAAAAAD5XaGV0aGVyIGEgbGVnYWN5IHBsYWludGV4dCBLWUMgcmVjb3JkIHN0aWxsIGV4aXN0cyBmb3IgYHVzZXJgLgAAAAAADmhhc19sZWdhY3lfa3ljAAAAAAABAAAAAAAAAAR1c2VyAAAAEwAAAAEAAAAB", "AAAAAAAAAGJBcHBseSB0aGUgcGVuZGluZyB1cGdyYWRlIG9uY2UgaXRzIHRpbWVsb2NrIGhhcyBlbGFwc2VkLiBBZG1pbi1vbmx5LgpFbWl0cyBgKGNvbnRyYWN0LCB1cGdyYWRlZClgLgAAAAAAD2V4ZWN1dGVfdXBncmFkZQAAAAABAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAA", "AAAAAAAAAJZQcm9wb3NlIGEgV0FTTSB1cGdyYWRlLiBBZG1pbi1vbmx5LiBSZXR1cm5zIHRoZSBsZWRnZXIgdGltZXN0YW1wIGFmdGVyCndoaWNoIGBleGVjdXRlX3VwZ3JhZGVgIG1heSBiZSBjYWxsZWQgKG5vdyArIDQ4aCkuIEVtaXRzCmAodXBncmFkZSwgcHJvcG9zZWQpYC4AAAAAAA9wcm9wb3NlX3VwZ3JhZGUAAAAAAgAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAA1uZXdfd2FzbV9oYXNoAAAAAAAD7gAAACAAAAABAAAABg==", "AAAAAAAAALxSZWdpc3RlciBhIHRoaXJkLXBhcnR5IEtZQyBpc3N1ZXIgd2hvc2UgY3VycmVudCBrZXkgaXMgYHNpZ25lcmAuCkFkbWluLW9ubHkuIFJldHVybnMgdGhlIG5ldyBpc3N1ZXIgaWQgKGlkcyBzdGFydCBhdCAxOyAwIGlzIHRoZQpwbGF0Zm9ybSBhZG1pbikuIEVtaXRzIGAoa3ljLCBpc3NfcmVnKWAg4oaSIGAoaWQsIHNpZ25lcilgLgAAAA9yZWdpc3Rlcl9pc3N1ZXIAAAAAAgAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAZzaWduZXIAAAAAABMAAAABAAAD6QAAAAQAAAfQAAAACEt5Y0Vycm9y", "AAAAAAAAAOdEZWxldGUgYSBwcmUtIzE3MTggcGxhaW50ZXh0IGF0dGVzdGF0aW9uIGZvciBgdXNlcmAuIEFkbWluLW9ubHkuClJldHVybnMgYGZhbHNlYCBpZiB0aGVyZSB3YXMgbm90aGluZyB0byBkZWxldGUuIExlZGdlciBoaXN0b3J5IHN0aWxsCmhvbGRzIHRoZSBvbGQgdmFsdWU7IHRoaXMgb25seSByZW1vdmVzIGl0IGZyb20gY3VycmVudCBzdGF0ZS4KCkV2ZW50OiBgKGt5YywgcHVyZ2VkKWAg4oaSIGB1c2VyYC4AAAAAEHB1cmdlX2xlZ2FjeV9reWMAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAABHVzZXIAAAATAAAAAQAAAAE=", "AAAAAAAAADFUaGUgbm9taW5hdGVkLWJ1dC1ub3QteWV0LWFjY2VwdGVkIGFkbWluLCBpZiBhbnkuAAAAAAAAEWdldF9wZW5kaW5nX2FkbWluAAAAAAAAAAAAAAEAAAPoAAAAEw==", "AAAAAAAAALtDb21taXRtZW50IHdyaXR0ZW4gYnkgYSByZWdpc3RlcmVkIGlzc3Vlciwgc2lnbmVkIGJ5IGl0cyBjdXJyZW50CmtleS4gYHR0bF9zZWNzYCBtdXN0IGJlIGluIGAxLi49TUFYX0tZQ19UVExfU0VDU2AuIEVtaXRzCmAoa3ljLCBpc3NfYXR0KWAg4oaSIGAodXNlciwgY29tbWl0bWVudCwgaXNzdWVyX2lkLCBleHBpcmVzX2F0KWAuAAAAABFpc3N1ZXJfYXR0ZXN0X2t5YwAAAAAAAAUAAAAAAAAABnNpZ25lcgAAAAAAEwAAAAAAAAAJaXNzdWVyX2lkAAAAAAAABAAAAAAAAAAEdXNlcgAAABMAAAAAAAAACmNvbW1pdG1lbnQAAAAAA+4AAAAgAAAAAAAAAAh0dGxfc2VjcwAAAAYAAAABAAAD6QAAAAIAAAfQAAAACEt5Y0Vycm9y", "AAAAAAAAAR1Sb3RhdGUgYW4gaXNzdWVyJ3Mga2V5LiBDYWxsYWJsZSBieSB0aGUgYWRtaW4gb3IgdGhlIGlzc3VlcidzIGN1cnJlbnQKc2lnbmVyLiBXaXRoIGBpbnZhbGlkYXRlX3ByZXZpb3VzYCwgZXZlcnkgYXR0ZXN0YXRpb24gc2lnbmVkIGJ5IGFuCm9sZGVyIGtleSBzdG9wcyB2YWxpZGF0aW5nIGltbWVkaWF0ZWx5IChPKDEpIOKAlCB0aGUgY29tcHJvbWlzZWQta2V5CnJlc3BvbnNlKS4gRW1pdHMgYChreWMsIGlzc19yb3QpYCDihpIgYChpZCwga2V5X3ZlcnNpb24sIGludmFsaWRhdGVfcHJldmlvdXMpYC4AAAAAAAARcm90YXRlX2lzc3Vlcl9rZXkAAAAAAAAEAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAACWlzc3Vlcl9pZAAAAAAAAAQAAAAAAAAACm5ld19zaWduZXIAAAAAABMAAAAAAAAAE2ludmFsaWRhdGVfcHJldmlvdXMAAAAAAQAAAAEAAAPpAAAABAAAB9AAAAAIS3ljRXJyb3I=", "AAAAAAAAADtUaGUgc3RvcmVkIGNvbW1pdG1lbnQgZm9yIGB1c2VyYCwgaWYgYW55LiBSZXZlYWxzIG5vIGxldmVsLgAAAAASZ2V0X2t5Y19jb21taXRtZW50AAAAAAABAAAAAAAAAAR1c2VyAAAAEwAAAAEAAAPoAAAH0AAAAA1LeWNDb21taXRtZW50AAAA", "AAAAAAAAAFZUaGUgc3RvcmVkIGF0dGVzdGF0aW9uLCB2YWxpZCBvciBub3QuIFJldmVhbHMgbm8gbGV2ZWw7IHVzZQpgY2hlY2tfa3ljYCBmb3IgZGVjaXNpb25zLgAAAAAAE2dldF9reWNfYXR0ZXN0YXRpb24AAAAAAQAAAAAAAAAEdXNlcgAAABMAAAABAAAD6AAAB9AAAAAOS3ljQXR0ZXN0YXRpb24AAA==", "AAAAAAAAADdUaGUgdXBncmFkZSBjdXJyZW50bHkgd2FpdGluZyBvdXQgaXRzIHRpbWVsb2NrLCBpZiBhbnkuAAAAABNnZXRfcGVuZGluZ191cGdyYWRlAAAAAAAAAAABAAAD6AAAB9AAAAAOUGVuZGluZ1VwZ3JhZGUAAA==", "AAAAAAAAAExXaXRoZHJhdyBhIHBlbmRpbmcgYWRtaW4gbm9taW5hdGlvbi4gQWRtaW4tb25seS4gRW1pdHMgYChhZG1pbiwgY2FuY2VsbGVkKWAuAAAAFWNhbmNlbF9hZG1pbl90cmFuc2ZlcgAAAAAAAAEAAAAAAAAABWFkbWluAAAAAAAAEwAAAAA=", "AAAAAAAAAHNDb21wdXRlIHRoZSBjb21taXRtZW50IGZvciBhbiBvcGVuaW5nLiBSZWFkLW9ubHkgaGVscGVyIHNvIGNsaWVudHMgY2FuCmNoZWNrIHRoZWlyIGVuY29kaW5nIG1hdGNoZXMgdGhlIGNvbnRyYWN0J3MuAAAAABZjb21wdXRlX2t5Y19jb21taXRtZW50AAAAAAACAAAAAAAAAAVsZXZlbAAAAAAAB9AAAAAIS3ljTGV2ZWwAAAAAAAAABHNhbHQAAAPuAAAAIAAAAAEAAAPuAAAAIA==", "AAAABAAAAK1FcnJvcnMgcmFpc2VkIGJ5IHRoZSBzaGFyZWQgdXBncmFkZS9hZG1pbiBoZWxwZXJzLgoKQ29kZXMgc3RhcnQgYXQgOTAwIHNvIHRoZXkgZG9uJ3Qgb3ZlcmxhcCBhbnkgY29udHJhY3QncyBvd24gZXJyb3IgZW51bTsKdGhleSBzdXJmYWNlIG9uLWNoYWluIGFzIGBFcnJvcihDb250cmFjdCwgIzl4eClgLgAAAAAAAAAAAAAMVXBncmFkZUVycm9yAAAABgAAAB9DYWxsZXIgaXMgbm90IHRoZSBzdG9yZWQgYWRtaW4uAAAAAAxVbmF1dGhvcml6ZWQAAAOEAAAAQWBleGVjdXRlX3VwZ3JhZGVgIC8gYGNhbmNlbF91cGdyYWRlYCBjYWxsZWQgd2l0aCBub3RoaW5nIHBlbmRpbmcuAAAAAAAAEE5vUGVuZGluZ1VwZ3JhZGUAAAOFAAAAMGBleGVjdXRlX3VwZ3JhZGVgIGNhbGxlZCBiZWZvcmUgYGV4ZWN1dGFibGVfYXRgLgAAABJUaW1lbG9ja05vdEVsYXBzZWQAAAAAA4YAAABFYGFjY2VwdF9hZG1pbmAgLyBgY2FuY2VsX2FkbWluX3RyYW5zZmVyYCBjYWxsZWQgd2l0aCBub3RoaW5nIHBlbmRpbmcuAAAAAAAADk5vUGVuZGluZ0FkbWluAAAAAAOHAAAAO2BhY2NlcHRfYWRtaW5gIHNpZ25lZCBieSBhbiBhZGRyZXNzIG90aGVyIHRoYW4gdGhlIG5vbWluZWUuAAAAAA9Ob3RQZW5kaW5nQWRtaW4AAAADiAAAACxgcHJvcG9zZV9hZG1pbmAgbm9taW5hdGVkIHRoZSBjdXJyZW50IGFkbWluLgAAAAlTYW1lQWRtaW4AAAAAAAOJ", "AAAAAQAAADFBIHByb3Bvc2VkIGNvZGUgdXBncmFkZSB3YWl0aW5nIG91dCBpdHMgdGltZWxvY2suAAAAAAAAAAAAAA5QZW5kaW5nVXBncmFkZQAAAAAAAwAAAAAAAAANZXhlY3V0YWJsZV9hdAAAAAAAAAYAAAAAAAAAC3Byb3Bvc2VkX2F0AAAAAAYAAAAAAAAACXdhc21faGFzaAAAAAAAA+4AAAAg"]),
      options
    );
  }

   static deploy<T = Client>(options: MethodOptions & Omit<ContractClientOptions, 'contractId'> & { wasmHash: Buffer | string; salt?: Buffer | Uint8Array; format?: "hex" | "base64"; address?: string; }): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options);
  }
  public readonly fromJSON = {
    get_tier : this.txFromJSON<VerificationTier>,  set_tier : this.txFromJSON<boolean>,  check_kyc : this.txFromJSON<boolean>,  get_proof : this.txFromJSON<SocialProof>,  has_proof : this.txFromJSON<boolean>,  attest_kyc : this.txFromJSON<void>,  get_issuer : this.txFromJSON<Result<KycIssuer, KycError>>,  initialize : this.txFromJSON<void>,  revoke_kyc : this.txFromJSON<void>,  verify_kyc : this.txFromJSON<boolean>,  proof_count : this.txFromJSON<number>,  revoke_tier : this.txFromJSON<void>,  accept_admin : this.txFromJSON<void>,  revoke_proof : this.txFromJSON<boolean>,  submit_proof : this.txFromJSON<boolean>,  propose_admin : this.txFromJSON<void>,  revoke_issuer : this.txFromJSON<Result<null, KycError>>,  cancel_upgrade : this.txFromJSON<void>,  has_legacy_kyc : this.txFromJSON<boolean>,  execute_upgrade : this.txFromJSON<void>,  propose_upgrade : this.txFromJSON<bigint>,  register_issuer : this.txFromJSON<Result<number, KycError>>,  purge_legacy_kyc : this.txFromJSON<boolean>,  get_pending_admin : this.txFromJSON<string | null>,  issuer_attest_kyc : this.txFromJSON<Result<null, KycError>>,  rotate_issuer_key : this.txFromJSON<Result<number, KycError>>,  get_kyc_commitment : this.txFromJSON<KycCommitment | null>,  get_kyc_attestation : this.txFromJSON<KycAttestation | null>,  get_pending_upgrade : this.txFromJSON<PendingUpgrade | null>,  cancel_admin_transfer : this.txFromJSON<void>,  compute_kyc_commitment : this.txFromJSON<Buffer>
  };

}