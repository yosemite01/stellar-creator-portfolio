import {VerificationTier, KycLevel, SocialProof, KycAttestation} from './types';
import {Spec, AssembledTransaction, Client as ContractClient, ClientOptions as ContractClientOptions, MethodOptions} from '@stellar/stellar-sdk/contract';
import {Address} from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';

export interface Client {
  /**
   * Upgrade the contract WASM. Only the governance multisig (admin) may call this.
   * Emits an `upgraded` event with the new wasm hash.
   */
  upgrade({ admin, new_wasm_hash }: { admin: string | Address; new_wasm_hash: Buffer }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Retrieve the tier attestation for a creator.
   * Returns None variant attestation if not yet set.
   */
  get_tier({ owner }: { owner: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<VerificationTier>>;
  /**
   * Attest a creator's verification tier on-chain.
   * Only the platform oracle (attester) may call this.
   */
  set_tier({ attester, owner, tier }: { attester: string | Address; owner: string | Address; tier: VerificationTier }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  check_kyc({ user, required_level }: { user: string | Address; required_level: KycLevel }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  get_proof({ owner, domain_hash }: { owner: string | Address; domain_hash: Buffer }, options?: MethodOptions): Promise<AssembledTransaction<SocialProof>>;
  has_proof({ owner, domain_hash }: { owner: string | Address; domain_hash: Buffer }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  attest_kyc({ admin, user, level }: { admin: string | Address; user: string | Address; level: KycLevel }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  initialize({ admin }: { admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Mark a user as KYC-verified following off-chain OCR document review
   * and admin approval (see `KYCSubmission` in the application database).
   * Only the platform admin may call this. Records a `Basic`-level
   * `KycAttestation` and emits an event carrying `kyc_submission_id` so
   * on-chain activity can be traced back to the reviewed document.
   */
  verify_kyc({ admin, user, kyc_submission_id }: { admin: string | Address; user: string | Address; kyc_submission_id: Buffer }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  proof_count({ owner }: { owner: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<number>>;
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
  get_kyc_attestation({ user }: { user: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<KycAttestation | null>>;
}

export class Client extends ContractClient {
  constructor(public readonly options: ContractClientOptions) {
    super(
      new Spec(["AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABQAAAAEAAAAAAAAABVByb29mAAAAAAAAAgAAABMAAAPuAAAAIAAAAAEAAAAAAAAAClByb29mQ291bnQAAAAAAAEAAAATAAAAAQAAAAAAAAAOS3ljQXR0ZXN0YXRpb24AAAAAAAEAAAATAAAAAAAAAAAAAAAFQWRtaW4AAAAAAAABAAAAAAAAAARUaWVyAAAAAQAAABM=", "AAAAAwAAAAAAAAAAAAAACEt5Y0xldmVsAAAAAwAAAAAAAAAFQmFzaWMAAAAAAAAAAAAAAAAAAAhFbmhhbmNlZAAAAAEAAAAAAAAADUluc3RpdHV0aW9uYWwAAAAAAAAC", "AAAAAQAAAAAAAAAAAAAAC1NvY2lhbFByb29mAAAAAAUAAAAAAAAAC2RvbWFpbl9oYXNoAAAAA+4AAAAgAAAAAAAAAAVvd25lcgAAAAAAABMAAAAAAAAABXByb29mAAAAAAAD7gAAAEAAAAAAAAAADHN1Ym1pdHRlZF9hdAAAAAYAAAAAAAAACHZlcmlmaWVkAAAAAQ==", "AAAABAAAAD5FcnJvciB0eXBlcyBmb3IgaWRlbnRpdHkgdmVyaWZpY2F0aW9uIG9wZXJhdGlvbnMgKElzc3VlICMxMzQxKQAAAAAAAAAAAA1JZGVudGl0eUVycm9yAAAAAAAABQAAAAAAAAAMVW5hdXRob3JpemVkAAAAAQAAAAAAAAAQSW52YWxpZFNpZ25hdHVyZQAAAAIAAAAAAAAAEUludmFsaWREb21haW5IYXNoAAAAAAAAAwAAAAAAAAAPQWxyZWFkeVZlcmlmaWVkAAAAAAQAAAAAAAAADVByb29mTm90Rm91bmQAAAAAAAAF", "AAAAAQAAAAAAAAAAAAAADkt5Y0F0dGVzdGF0aW9uAAAAAAAEAAAAAAAAAAthdHRlc3RlZF9hdAAAAAAGAAAAAAAAAApleHBpcmVzX2F0AAAAAAAGAAAAAAAAAAVsZXZlbAAAAAAAB9AAAAAIS3ljTGV2ZWwAAAAAAAAABHVzZXIAAAAT", "AAAAAQAAADBUaWVyIGF0dGVzdGF0aW9uIHN0b3JlZCBmb3IgZWFjaCBjcmVhdG9yIGFkZHJlc3MAAAAAAAAAD1RpZXJBdHRlc3RhdGlvbgAAAAAEAAAAAAAAAAthdHRlc3RlZF9hdAAAAAAGAAAAAAAAAAthdHRlc3RlZF9ieQAAAAATAAAAAAAAAAVvd25lcgAAAAAAABMAAAAAAAAABHRpZXIAAAfQAAAAEFZlcmlmaWNhdGlvblRpZXI=", "AAAAAgAAAH1Pbi1jaGFpbiB0aWVyIGxldmVscyBtaXJyb3JpbmcgdGhlIERCIGVudW0uClN0b3JlZCBhcyB1MzIgZm9yIGNvbXBhY3QgU29yb2JhbiBzdG9yYWdlLgpOT05FPTAgIFZFUklGSUVEPTEgIFRSVVNURUQ9MiAgRUxJVEU9MwAAAAAAAAAAAAAQVmVyaWZpY2F0aW9uVGllcgAAAAQAAAAAAAAAAAAAAAROb25lAAAAAAAAAAAAAAAIVmVyaWZpZWQAAAAAAAAAAAAAAAdUcnVzdGVkAAAAAAAAAAAAAAAABUVsaXRlAAAA", "AAAAAQAAAF1EZWNlbnRyYWxpemVkIGF1dGhlbnRpY2l0eSByZWNvcmQgbGlua2luZyBhbiBhZGRyZXNzIHRvIHZlcmlmaWVkIHNvY2lhbCBkb21haW5zIChJc3N1ZSAjMTM0MSkAAAAAAAAAAAAAEURvbWFpbkF0dGVzdGF0aW9uAAAAAAAABAAAAAAAAAAHYWRkcmVzcwAAAAATAAAAAAAAAAthdHRlc3RlZF9hdAAAAAAGAAAAAAAAAAtkb21haW5faGFzaAAAAAPuAAAAIAAAAAAAAAAIdmVyaWZpZWQAAAAB", "AAAAAAAAAIBVcGdyYWRlIHRoZSBjb250cmFjdCBXQVNNLiBPbmx5IHRoZSBnb3Zlcm5hbmNlIG11bHRpc2lnIChhZG1pbikgbWF5IGNhbGwgdGhpcy4KRW1pdHMgYW4gYHVwZ3JhZGVkYCBldmVudCB3aXRoIHRoZSBuZXcgd2FzbSBoYXNoLgAAAAd1cGdyYWRlAAAAAAIAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAANbmV3X3dhc21faGFzaAAAAAAAA+4AAAAgAAAAAA==", "AAAAAAAAAF1SZXRyaWV2ZSB0aGUgdGllciBhdHRlc3RhdGlvbiBmb3IgYSBjcmVhdG9yLgpSZXR1cm5zIE5vbmUgdmFyaWFudCBhdHRlc3RhdGlvbiBpZiBub3QgeWV0IHNldC4AAAAAAAAIZ2V0X3RpZXIAAAABAAAAAAAAAAVvd25lcgAAAAAAABMAAAABAAAH0AAAABBWZXJpZmljYXRpb25UaWVy", "AAAAAAAAAGFBdHRlc3QgYSBjcmVhdG9yJ3MgdmVyaWZpY2F0aW9uIHRpZXIgb24tY2hhaW4uCk9ubHkgdGhlIHBsYXRmb3JtIG9yYWNsZSAoYXR0ZXN0ZXIpIG1heSBjYWxsIHRoaXMuAAAAAAAACHNldF90aWVyAAAAAwAAAAAAAAAIYXR0ZXN0ZXIAAAATAAAAAAAAAAVvd25lcgAAAAAAABMAAAAAAAAABHRpZXIAAAfQAAAAEFZlcmlmaWNhdGlvblRpZXIAAAABAAAAAQ==", "AAAAAAAAAAAAAAAJY2hlY2tfa3ljAAAAAAAAAgAAAAAAAAAEdXNlcgAAABMAAAAAAAAADnJlcXVpcmVkX2xldmVsAAAAAAfQAAAACEt5Y0xldmVsAAAAAQAAAAE=", "AAAAAAAAAAAAAAAJZ2V0X3Byb29mAAAAAAAAAgAAAAAAAAAFb3duZXIAAAAAAAATAAAAAAAAAAtkb21haW5faGFzaAAAAAPuAAAAIAAAAAEAAAfQAAAAC1NvY2lhbFByb29mAA==", "AAAAAAAAAAAAAAAJaGFzX3Byb29mAAAAAAAAAgAAAAAAAAAFb3duZXIAAAAAAAATAAAAAAAAAAtkb21haW5faGFzaAAAAAPuAAAAIAAAAAEAAAAB", "AAAAAAAAAAAAAAAKYXR0ZXN0X2t5YwAAAAAAAwAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAR1c2VyAAAAEwAAAAAAAAAFbGV2ZWwAAAAAAAfQAAAACEt5Y0xldmVsAAAAAA==", "AAAAAAAAAAAAAAAKaW5pdGlhbGl6ZQAAAAAAAQAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAA==", "AAAAAAAAAUtNYXJrIGEgdXNlciBhcyBLWUMtdmVyaWZpZWQgZm9sbG93aW5nIG9mZi1jaGFpbiBPQ1IgZG9jdW1lbnQgcmV2aWV3CmFuZCBhZG1pbiBhcHByb3ZhbCAoc2VlIGBLWUNTdWJtaXNzaW9uYCBpbiB0aGUgYXBwbGljYXRpb24gZGF0YWJhc2UpLgpPbmx5IHRoZSBwbGF0Zm9ybSBhZG1pbiBtYXkgY2FsbCB0aGlzLiBSZWNvcmRzIGEgYEJhc2ljYC1sZXZlbApgS3ljQXR0ZXN0YXRpb25gIGFuZCBlbWl0cyBhbiBldmVudCBjYXJyeWluZyBga3ljX3N1Ym1pc3Npb25faWRgIHNvCm9uLWNoYWluIGFjdGl2aXR5IGNhbiBiZSB0cmFjZWQgYmFjayB0byB0aGUgcmV2aWV3ZWQgZG9jdW1lbnQuAAAAAAp2ZXJpZnlfa3ljAAAAAAADAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAABHVzZXIAAAATAAAAAAAAABFreWNfc3VibWlzc2lvbl9pZAAAAAAAA+4AAAAgAAAAAQAAAAE=", "AAAAAAAAAAAAAAALcHJvb2ZfY291bnQAAAAAAQAAAAAAAAAFb3duZXIAAAAAAAATAAAAAQAAAAQ=", "AAAAAAAAAAAAAAAMcmV2b2tlX3Byb29mAAAAAgAAAAAAAAAFb3duZXIAAAAAAAATAAAAAAAAAAtkb21haW5faGFzaAAAAAPuAAAAIAAAAAEAAAAB", "AAAAAAAAAq5TdWJtaXQgYSBjcnlwdG9ncmFwaGljIHByb29mIGxpbmtpbmcgYW4gYWRkcmVzcyB0byBhIHNvY2lhbCBkb21haW4uClZlcmlmaWVzIHRoZSBFZDI1NTE5IHNpZ25hdHVyZSBvZiBgZG9tYWluX2hhc2hgIHVuZGVyIGBwdWJsaWNfa2V5YApuYXRpdmVseSB2aWEgYGVudi5jcnlwdG8oKS5lZDI1NTE5X3ZlcmlmeWAuCgojIEFyZ3VtZW50cwoqIGBvd25lcmAgLSBUaGUgQWRkcmVzcyBzdWJtaXR0aW5nIHRoZSBwcm9vZiAobXVzdCBhdXRoZW50aWNhdGUpCiogYGRvbWFpbl9oYXNoYCAtIFRoZSAzMi1ieXRlIGhhc2ggb2YgdGhlIHNvY2lhbCBkb21haW4vaGFuZGxlCiogYHB1YmxpY19rZXlgIC0gVGhlIEVkMjU1MTkgcHVibGljIGtleSB1c2VkIGZvciBzaWduYXR1cmUgdmVyaWZpY2F0aW9uCiogYHByb29mYCAtIFRoZSBFZDI1NTE5IHNpZ25hdHVyZSBwcm9vZiAoNjQgYnl0ZXMpCgojIFJldHVybnMKYm9vbCAtIHRydWUgb24gc3VjY2Vzc2Z1bCB2ZXJpZmljYXRpb24KCiMgRXJyb3JzClBhbmljcyB3aXRoIG1lc3NhZ2UgaWY6Ci0gYG93bmVyYCBkb2VzIG5vdCBhdXRoZW50aWNhdGUgdGhlIGNhbGwKLSBQcm9vZiBpcyBhbHJlYWR5IHZlcmlmaWVkIGZvciB0aGlzIG93bmVyK2RvbWFpbl9oYXNoIHBhaXIKLSBFZDI1NTE5IHNpZ25hdHVyZSB2ZXJpZmljYXRpb24gZmFpbHMgKGludmFsaWQgc2lnbmF0dXJlKQAAAAAADHN1Ym1pdF9wcm9vZgAAAAQAAAAAAAAABW93bmVyAAAAAAAAEwAAAAAAAAALZG9tYWluX2hhc2gAAAAD7gAAACAAAAAAAAAACnB1YmxpY19rZXkAAAAAA+4AAAAgAAAAAAAAAAVwcm9vZgAAAAAAA+4AAABAAAAAAQAAAAE=", "AAAAAAAAAAAAAAATZ2V0X2t5Y19hdHRlc3RhdGlvbgAAAAABAAAAAAAAAAR1c2VyAAAAEwAAAAEAAAPoAAAH0AAAAA5LeWNBdHRlc3RhdGlvbgAA"]),
      options
    );
  }

   static deploy<T = Client>(options: MethodOptions & Omit<ContractClientOptions, 'contractId'> & { wasmHash: Buffer | string; salt?: Buffer | Uint8Array; format?: "hex" | "base64"; address?: string; }): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options);
  }
  public readonly fromJSON = {
    upgrade : this.txFromJSON<void>,  get_tier : this.txFromJSON<VerificationTier>,  set_tier : this.txFromJSON<boolean>,  check_kyc : this.txFromJSON<boolean>,  get_proof : this.txFromJSON<SocialProof>,  has_proof : this.txFromJSON<boolean>,  attest_kyc : this.txFromJSON<void>,  initialize : this.txFromJSON<void>,  verify_kyc : this.txFromJSON<boolean>,  proof_count : this.txFromJSON<number>,  revoke_proof : this.txFromJSON<boolean>,  submit_proof : this.txFromJSON<boolean>,  get_kyc_attestation : this.txFromJSON<KycAttestation | null>
  };

}