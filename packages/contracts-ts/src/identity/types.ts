import {Address} from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';

    /**
 * Typed errors for the KYC issuer registry (#1717). Surface on-chain as
 * `Error(Contract, #n)`; never renumber, only append.
 */
export const KycError = {
  101 : { message: "NotInitialized" },
  102 : { message: "Unauthorized" },
  103 : { message: "IssuerNotFound" },
  104 : { message: "IssuerRevoked" },
  105 : { message: "InvalidTtl" },
  106 : { message: "AttestationNotFound" }
}

/**
 * Enum: KycLevel
 */
export enum KycLevel {
  /**
   * Enum Case: Basic
   */
  Basic = 0,
  /**
   * Enum Case: Enhanced
   */
  Enhanced = 1,
  /**
   * Enum Case: Institutional
   */
  Institutional = 2
}

/**
 * A registered KYC issuer. `signer` is the issuer's current key; rotating
 * it bumps `key_version`. Attestations signed by a key older than
 * `min_key_version` are invalid, and a `revoked` issuer invalidates every
 * attestation it ever wrote.
 */
export interface KycIssuer {
  id: number;
  key_version: number;
  min_key_version: number;
  registered_at: bigint;
  revoked: boolean;
  signer: string;
}

/**
 * Struct: SocialProof
 */
export interface SocialProof {
  domain_hash: Buffer;
  owner: string;
  proof: Buffer;
  submitted_at: bigint;
  verified: boolean;
}

/**
 * Commitment view of a user's attestation (#1718). Reveals no level.
 */
export interface KycCommitment {
  attested_at: bigint;
  commitment: Buffer;
  expires_at: bigint;
}

/**
 * KYC attestation (schema v3). Each attestation names the issuer that
 * wrote it and the issuer key version that signed it, so an issuer (or one
 * of its compromised keys) can be cut off in O(1) without touching
 * individual attestations (#1717). Contract storage is public, so only a
 * salted commitment to the level is stored, never the level itself (#1718).
 */
export interface KycAttestation {
  /**
   * `sha256([level as u8] || salt)`; see [`kyc_commitment`].
   */
  commitment: Buffer;
  expires_at: bigint;
  issued_at: bigint;
  issuer_id: number;
  key_version: number;
  schema_version: number;
  user: string;
}

/**
 * On-chain tier levels mirroring the DB enum.
 * Stored as u32 for compact Soroban storage.
 * NONE=0  VERIFIED=1  TRUSTED=2  ELITE=3
 */
 export type VerificationTier =
  { tag: "None"; values: void } |
  { tag: "Verified"; values: void } |
  { tag: "Trusted"; values: void } |
  { tag: "Elite"; values: void };

/**
 * Errors raised by the shared upgrade/admin helpers.
 *
 * Codes start at 900 so they don't overlap any contract's own error enum;
 * they surface on-chain as `Error(Contract, #9xx)`.
 */
export const UpgradeError = {
  /**
   * Caller is not the stored admin.
   */
  900 : { message: "Unauthorized" },
  /**
   * `execute_upgrade` / `cancel_upgrade` called with nothing pending.
   */
  901 : { message: "NoPendingUpgrade" },
  /**
   * `execute_upgrade` called before `executable_at`.
   */
  902 : { message: "TimelockNotElapsed" },
  /**
   * `accept_admin` / `cancel_admin_transfer` called with nothing pending.
   */
  903 : { message: "NoPendingAdmin" },
  /**
   * `accept_admin` signed by an address other than the nominee.
   */
  904 : { message: "NotPendingAdmin" },
  /**
   * `propose_admin` nominated the current admin.
   */
  905 : { message: "SameAdmin" }
}

/**
 * A proposed code upgrade waiting out its timelock.
 */
export interface PendingUpgrade {
  executable_at: bigint;
  proposed_at: bigint;
  wasm_hash: Buffer;
}
    
    
export type KycError = (typeof KycError)[keyof typeof KycError];

export type UpgradeError = (typeof UpgradeError)[keyof typeof UpgradeError];
