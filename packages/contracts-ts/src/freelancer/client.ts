import {FreelancerError, FreelancerProfile, PendingUpgrade, IdentityMetadata} from './types';
import {Result, Spec, AssembledTransaction, Client as ContractClient, ClientOptions as ContractClientOptions, MethodOptions} from '@stellar/stellar-sdk/contract';
import {Address} from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';

export interface Client {
  /**
   * Set the contract owner. Must be called once after deployment.
   */
  initialize({ owner }: { owner: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, FreelancerError>>>;
  get_profile({ freelancer }: { freelancer: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<FreelancerProfile, FreelancerError>>>;
  is_verified({ freelancer }: { freelancer: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  /**
   * Accept a nomination (step 2 of 2). Must be signed by the nominee.
   * Emits `(admin, accepted)`.
   */
  accept_admin({ new_admin }: { new_admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Nominate a new admin (step 1 of 2). Admin-only. Emits `(admin, proposed)`.
   */
  propose_admin({ admin, new_admin }: { admin: string | Address; new_admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Post a rating for a freelancer. `source` must be the configured review
   * contract and must authorize the call — a contract calling this one
   * directly satisfies `require_auth` for its own address, so only that
   * contract can post ratings. The owner can no longer rate (#1726).
   *
   * `new_rating` must be in [0, 500] (0–5 stars × 100). (#183)
   */
  update_rating({ source, freelancer, new_rating }: { source: string | Address; freelancer: string | Address; new_rating: number }, options?: MethodOptions): Promise<AssembledTransaction<Result<boolean, FreelancerError>>>;
  /**
   * Withdraw the pending upgrade. Admin-only. Emits `(upgrade, cancelled)`.
   */
  cancel_upgrade({ admin }: { admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
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
  get_escrow_source(options?: MethodOptions): Promise<AssembledTransaction<string | null>>;
  /**
   * The nominated-but-not-yet-accepted admin, if any.
   */
  get_pending_admin(options?: MethodOptions): Promise<AssembledTransaction<string | null>>;
  get_review_source(options?: MethodOptions): Promise<AssembledTransaction<string | null>>;
  /**
   * Configure the escrow contract earnings are derived from. Owner-only.
   * Emits `(freelncr, esc_src)`.
   */
  set_escrow_source({ escrow }: { escrow: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, FreelancerError>>>;
  /**
   * Configure the review contract allowed to post ratings. Owner-only.
   * Emits `(freelncr, rev_src)`.
   */
  set_review_source({ review }: { review: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, FreelancerError>>>;
  /**
   * Verify a freelancer. Only the contract owner may call this. (#312)
   */
  verify_freelancer({ freelancer }: { freelancer: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<boolean, FreelancerError>>>;
  /**
   * Whether an escrow has already been credited.
   */
  is_escrow_credited({ escrow_id }: { escrow_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  /**
   * The upgrade currently waiting out its timelock, if any.
   */
  get_pending_upgrade(options?: MethodOptions): Promise<AssembledTransaction<PendingUpgrade | null>>;
  /**
   * One-shot migration (#1726): zero the stats of a profile created before
   * stat writes were restricted, since those values were admin-written and
   * unverified. They are then rebuilt via `record_escrow_release` and
   * `update_rating`. Owner-only; can only reset (never set) values, and only
   * once per profile. Profiles registered after this upgrade are marked
   * migrated at registration. Emits `(freelncr, migrated)`.
   */
  migrate_reset_stats({ freelancer }: { freelancer: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<boolean, FreelancerError>>>;
  register_freelancer({ freelancer, name, discipline, bio }: { freelancer: string | Address; name: string; discipline: string; bio: string }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  /**
   * Withdraw a pending admin nomination. Admin-only. Emits `(admin, cancelled)`.
   */
  cancel_admin_transfer({ admin }: { admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  get_freelancers_count(options?: MethodOptions): Promise<AssembledTransaction<number>>;
  /**
   * Retrieve identity metadata for a given address.
   */
  get_identity_metadata({ user }: { user: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<IdentityMetadata, FreelancerError>>>;
  /**
   * Credit a released escrow to its payee's profile. Permissionless: the
   * escrow is read from the configured escrow contract and must be
   * `Released` to a registered freelancer. Each escrow is credited once.
   * Adds `escrow.amount` to earnings and increments completed projects.
   * Emits `(freelncr, earnings)` and `(freelncr, completed)`.
   */
  record_escrow_release({ escrow_id }: { escrow_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<boolean, FreelancerError>>>;
  /**
   * Set identity metadata for the authenticated user.
   */
  set_identity_metadata({ user, metadata }: { user: string | Address; metadata: Map<string, string> }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  /**
   * Retrieve the user address associated with a public key.
   */
  get_user_by_public_key({ public_key }: { public_key: string }, options?: MethodOptions): Promise<AssembledTransaction<string | null>>;
  /**
   * Map a Stellar public key to a user address. Only the contract owner may call this.
   */
  set_public_key_mapping({ public_key, user }: { public_key: string; user: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, FreelancerError>>>;
}

export class Client extends ContractClient {
  constructor(public readonly options: ContractClientOptions) {
    super(
      new Spec(["AAAABAAAAMdUeXBlZCBlcnJvcnMgcmV0dXJuZWQgYnkgZnJlZWxhbmNlciBlbnRyeXBvaW50cyAoIzE1NjIpLgoKQ29kZXMgYXJlIHBhcnQgb2YgdGhlIGNvbnRyYWN0J3MgcHVibGljIGludGVyZmFjZTogbmV2ZXIgcmVudW1iZXIgYW4KZXhpc3RpbmcgdmFyaWFudCwgb25seSBhcHBlbmQuIFNlZSBkb2NzL2NvbnRyYWN0cy5tZCBmb3IgdGhlIGZ1bGwgdGFibGUuAAAAAAAAAAAPRnJlZWxhbmNlckVycm9yAAAAAAoAAAAAAAAAEkFscmVhZHlJbml0aWFsaXplZAAAAAAAAQAAAAAAAAAOTm90SW5pdGlhbGl6ZWQAAAAAAAIAAAAAAAAADU5vdFJlZ2lzdGVyZWQAAAAAAAADAAAAAAAAAA1JbnZhbGlkUmF0aW5nAAAAAAAABAAAAAAAAAAQSWRlbnRpdHlOb3RGb3VuZAAAAAUAAAAAAAAADFVuYXV0aG9yaXplZAAAAAYAAAA3RXNjcm93IC8gcmV2aWV3IHNvdXJjZSBjb250cmFjdCBub3QgY29uZmlndXJlZCAoIzE3MjYpLgAAAAATU291cmNlTm90Q29uZmlndXJlZAAAAAAHAAAAN1RoZSBlc2Nyb3cgd2FzIG5vdCByZWxlYXNlZCB0byB0aGlzIGZyZWVsYW5jZXIgKCMxNzI2KS4AAAAAEUVzY3Jvd05vdFJlbGVhc2VkAAAAAAAACAAAADVUaGUgZXNjcm93IHJlbGVhc2UgaGFzIGFscmVhZHkgYmVlbiBjcmVkaXRlZCAoIzE3MjYpLgAAAAAAAA9BbHJlYWR5Q3JlZGl0ZWQAAAAACQAAADVTdGF0cyBmb3IgdGhpcyBwcm9maWxlIHdlcmUgYWxyZWFkeSBtaWdyYXRlZCAoIzE3MjYpLgAAAAAAAA9BbHJlYWR5TWlncmF0ZWQAAAAACg==", "AAAAAQAAABpJZGVudGl0eSBSZWdpc3RyeSBNZXRhZGF0YQAAAAAAAAAAABBJZGVudGl0eU1ldGFkYXRhAAAAAwAAAAAAAAAHYWRkcmVzcwAAAAATAAAAAAAAAAxsYXN0X3VwZGF0ZWQAAAAGAAAAAAAAAAhtZXRhZGF0YQAAA+wAAAAQAAAAEA==", "AAAAAQAAABJGcmVlbGFuY2VyIFByb2ZpbGUAAAAAAAAAAAARRnJlZWxhbmNlclByb2ZpbGUAAAAAAAAKAAAAAAAAAAdhZGRyZXNzAAAAABMAAAAAAAAAA2JpbwAAAAAQAAAAAAAAABJjb21wbGV0ZWRfcHJvamVjdHMAAAAAAAQAAAAAAAAACmNyZWF0ZWRfYXQAAAAAAAYAAAAAAAAACmRpc2NpcGxpbmUAAAAAABAAAAAAAAAABG5hbWUAAAAQAAAAAAAAAAZyYXRpbmcAAAAAAAQAAAAAAAAADnRvdGFsX2Vhcm5pbmdzAAAAAAALAAAAAAAAABJ0b3RhbF9yYXRpbmdfY291bnQAAAAAAAQAAAAAAAAACHZlcmlmaWVkAAAAAQ==", "AAAAAAAAAD1TZXQgdGhlIGNvbnRyYWN0IG93bmVyLiBNdXN0IGJlIGNhbGxlZCBvbmNlIGFmdGVyIGRlcGxveW1lbnQuAAAAAAAACmluaXRpYWxpemUAAAAAAAEAAAAAAAAABW93bmVyAAAAAAAAEwAAAAEAAAPpAAAAAgAAB9AAAAAPRnJlZWxhbmNlckVycm9yAA==", "AAAAAAAAAAAAAAALZ2V0X3Byb2ZpbGUAAAAAAQAAAAAAAAAKZnJlZWxhbmNlcgAAAAAAEwAAAAEAAAPpAAAH0AAAABFGcmVlbGFuY2VyUHJvZmlsZQAAAAAAB9AAAAAPRnJlZWxhbmNlckVycm9yAA==", "AAAAAAAAAAAAAAALaXNfdmVyaWZpZWQAAAAAAQAAAAAAAAAKZnJlZWxhbmNlcgAAAAAAEwAAAAEAAAAB", "AAAAAAAAAFxBY2NlcHQgYSBub21pbmF0aW9uIChzdGVwIDIgb2YgMikuIE11c3QgYmUgc2lnbmVkIGJ5IHRoZSBub21pbmVlLgpFbWl0cyBgKGFkbWluLCBhY2NlcHRlZClgLgAAAAxhY2NlcHRfYWRtaW4AAAABAAAAAAAAAAluZXdfYWRtaW4AAAAAAAATAAAAAA==", "AAAAAAAAAEpOb21pbmF0ZSBhIG5ldyBhZG1pbiAoc3RlcCAxIG9mIDIpLiBBZG1pbi1vbmx5LiBFbWl0cyBgKGFkbWluLCBwcm9wb3NlZClgLgAAAAAADXByb3Bvc2VfYWRtaW4AAAAAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAACW5ld19hZG1pbgAAAAAAABMAAAAA", "AAAAAAAAAU9Qb3N0IGEgcmF0aW5nIGZvciBhIGZyZWVsYW5jZXIuIGBzb3VyY2VgIG11c3QgYmUgdGhlIGNvbmZpZ3VyZWQgcmV2aWV3CmNvbnRyYWN0IGFuZCBtdXN0IGF1dGhvcml6ZSB0aGUgY2FsbCDigJQgYSBjb250cmFjdCBjYWxsaW5nIHRoaXMgb25lCmRpcmVjdGx5IHNhdGlzZmllcyBgcmVxdWlyZV9hdXRoYCBmb3IgaXRzIG93biBhZGRyZXNzLCBzbyBvbmx5IHRoYXQKY29udHJhY3QgY2FuIHBvc3QgcmF0aW5ncy4gVGhlIG93bmVyIGNhbiBubyBsb25nZXIgcmF0ZSAoIzE3MjYpLgoKYG5ld19yYXRpbmdgIG11c3QgYmUgaW4gWzAsIDUwMF0gKDDigJM1IHN0YXJzIMOXIDEwMCkuICgjMTgzKQAAAAANdXBkYXRlX3JhdGluZwAAAAAAAAMAAAAAAAAABnNvdXJjZQAAAAAAEwAAAAAAAAAKZnJlZWxhbmNlcgAAAAAAEwAAAAAAAAAKbmV3X3JhdGluZwAAAAAABAAAAAEAAAPpAAAAAQAAB9AAAAAPRnJlZWxhbmNlckVycm9yAA==", "AAAAAAAAAEdXaXRoZHJhdyB0aGUgcGVuZGluZyB1cGdyYWRlLiBBZG1pbi1vbmx5LiBFbWl0cyBgKHVwZ3JhZGUsIGNhbmNlbGxlZClgLgAAAAAOY2FuY2VsX3VwZ3JhZGUAAAAAAAEAAAAAAAAABWFkbWluAAAAAAAAEwAAAAA=", "AAAAAAAAAGJBcHBseSB0aGUgcGVuZGluZyB1cGdyYWRlIG9uY2UgaXRzIHRpbWVsb2NrIGhhcyBlbGFwc2VkLiBBZG1pbi1vbmx5LgpFbWl0cyBgKGNvbnRyYWN0LCB1cGdyYWRlZClgLgAAAAAAD2V4ZWN1dGVfdXBncmFkZQAAAAABAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAA", "AAAAAAAAAJZQcm9wb3NlIGEgV0FTTSB1cGdyYWRlLiBBZG1pbi1vbmx5LiBSZXR1cm5zIHRoZSBsZWRnZXIgdGltZXN0YW1wIGFmdGVyCndoaWNoIGBleGVjdXRlX3VwZ3JhZGVgIG1heSBiZSBjYWxsZWQgKG5vdyArIDQ4aCkuIEVtaXRzCmAodXBncmFkZSwgcHJvcG9zZWQpYC4AAAAAAA9wcm9wb3NlX3VwZ3JhZGUAAAAAAgAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAA1uZXdfd2FzbV9oYXNoAAAAAAAD7gAAACAAAAABAAAABg==", "AAAAAAAAAAAAAAARZ2V0X2VzY3Jvd19zb3VyY2UAAAAAAAAAAAAAAQAAA+gAAAAT", "AAAAAAAAADFUaGUgbm9taW5hdGVkLWJ1dC1ub3QteWV0LWFjY2VwdGVkIGFkbWluLCBpZiBhbnkuAAAAAAAAEWdldF9wZW5kaW5nX2FkbWluAAAAAAAAAAAAAAEAAAPoAAAAEw==", "AAAAAAAAAAAAAAARZ2V0X3Jldmlld19zb3VyY2UAAAAAAAAAAAAAAQAAA+gAAAAT", "AAAAAAAAAGFDb25maWd1cmUgdGhlIGVzY3JvdyBjb250cmFjdCBlYXJuaW5ncyBhcmUgZGVyaXZlZCBmcm9tLiBPd25lci1vbmx5LgpFbWl0cyBgKGZyZWVsbmNyLCBlc2Nfc3JjKWAuAAAAAAAAEXNldF9lc2Nyb3dfc291cmNlAAAAAAAAAQAAAAAAAAAGZXNjcm93AAAAAAATAAAAAQAAA+kAAAACAAAH0AAAAA9GcmVlbGFuY2VyRXJyb3IA", "AAAAAAAAAF9Db25maWd1cmUgdGhlIHJldmlldyBjb250cmFjdCBhbGxvd2VkIHRvIHBvc3QgcmF0aW5ncy4gT3duZXItb25seS4KRW1pdHMgYChmcmVlbG5jciwgcmV2X3NyYylgLgAAAAARc2V0X3Jldmlld19zb3VyY2UAAAAAAAABAAAAAAAAAAZyZXZpZXcAAAAAABMAAAABAAAD6QAAAAIAAAfQAAAAD0ZyZWVsYW5jZXJFcnJvcgA=", "AAAAAAAAAEJWZXJpZnkgYSBmcmVlbGFuY2VyLiBPbmx5IHRoZSBjb250cmFjdCBvd25lciBtYXkgY2FsbCB0aGlzLiAoIzMxMikAAAAAABF2ZXJpZnlfZnJlZWxhbmNlcgAAAAAAAAEAAAAAAAAACmZyZWVsYW5jZXIAAAAAABMAAAABAAAD6QAAAAEAAAfQAAAAD0ZyZWVsYW5jZXJFcnJvcgA=", "AAAAAAAAACxXaGV0aGVyIGFuIGVzY3JvdyBoYXMgYWxyZWFkeSBiZWVuIGNyZWRpdGVkLgAAABJpc19lc2Nyb3dfY3JlZGl0ZWQAAAAAAAEAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAYAAAABAAAAAQ==", "AAAAAAAAADdUaGUgdXBncmFkZSBjdXJyZW50bHkgd2FpdGluZyBvdXQgaXRzIHRpbWVsb2NrLCBpZiBhbnkuAAAAABNnZXRfcGVuZGluZ191cGdyYWRlAAAAAAAAAAABAAAD6AAAB9AAAAAOUGVuZGluZ1VwZ3JhZGUAAA==", "AAAAAAAAAZRPbmUtc2hvdCBtaWdyYXRpb24gKCMxNzI2KTogemVybyB0aGUgc3RhdHMgb2YgYSBwcm9maWxlIGNyZWF0ZWQgYmVmb3JlCnN0YXQgd3JpdGVzIHdlcmUgcmVzdHJpY3RlZCwgc2luY2UgdGhvc2UgdmFsdWVzIHdlcmUgYWRtaW4td3JpdHRlbiBhbmQKdW52ZXJpZmllZC4gVGhleSBhcmUgdGhlbiByZWJ1aWx0IHZpYSBgcmVjb3JkX2VzY3Jvd19yZWxlYXNlYCBhbmQKYHVwZGF0ZV9yYXRpbmdgLiBPd25lci1vbmx5OyBjYW4gb25seSByZXNldCAobmV2ZXIgc2V0KSB2YWx1ZXMsIGFuZCBvbmx5Cm9uY2UgcGVyIHByb2ZpbGUuIFByb2ZpbGVzIHJlZ2lzdGVyZWQgYWZ0ZXIgdGhpcyB1cGdyYWRlIGFyZSBtYXJrZWQKbWlncmF0ZWQgYXQgcmVnaXN0cmF0aW9uLiBFbWl0cyBgKGZyZWVsbmNyLCBtaWdyYXRlZClgLgAAABNtaWdyYXRlX3Jlc2V0X3N0YXRzAAAAAAEAAAAAAAAACmZyZWVsYW5jZXIAAAAAABMAAAABAAAD6QAAAAEAAAfQAAAAD0ZyZWVsYW5jZXJFcnJvcgA=", "AAAAAAAAAAAAAAATcmVnaXN0ZXJfZnJlZWxhbmNlcgAAAAAEAAAAAAAAAApmcmVlbGFuY2VyAAAAAAATAAAAAAAAAARuYW1lAAAAEAAAAAAAAAAKZGlzY2lwbGluZQAAAAAAEAAAAAAAAAADYmlvAAAAABAAAAABAAAAAQ==", "AAAAAAAAAExXaXRoZHJhdyBhIHBlbmRpbmcgYWRtaW4gbm9taW5hdGlvbi4gQWRtaW4tb25seS4gRW1pdHMgYChhZG1pbiwgY2FuY2VsbGVkKWAuAAAAFWNhbmNlbF9hZG1pbl90cmFuc2ZlcgAAAAAAAAEAAAAAAAAABWFkbWluAAAAAAAAEwAAAAA=", "AAAAAAAAAAAAAAAVZ2V0X2ZyZWVsYW5jZXJzX2NvdW50AAAAAAAAAAAAAAEAAAAE", "AAAAAAAAAC9SZXRyaWV2ZSBpZGVudGl0eSBtZXRhZGF0YSBmb3IgYSBnaXZlbiBhZGRyZXNzLgAAAAAVZ2V0X2lkZW50aXR5X21ldGFkYXRhAAAAAAAAAQAAAAAAAAAEdXNlcgAAABMAAAABAAAD6QAAB9AAAAAQSWRlbnRpdHlNZXRhZGF0YQAAB9AAAAAPRnJlZWxhbmNlckVycm9yAA==", "AAAAAAAAAUZDcmVkaXQgYSByZWxlYXNlZCBlc2Nyb3cgdG8gaXRzIHBheWVlJ3MgcHJvZmlsZS4gUGVybWlzc2lvbmxlc3M6IHRoZQplc2Nyb3cgaXMgcmVhZCBmcm9tIHRoZSBjb25maWd1cmVkIGVzY3JvdyBjb250cmFjdCBhbmQgbXVzdCBiZQpgUmVsZWFzZWRgIHRvIGEgcmVnaXN0ZXJlZCBmcmVlbGFuY2VyLiBFYWNoIGVzY3JvdyBpcyBjcmVkaXRlZCBvbmNlLgpBZGRzIGBlc2Nyb3cuYW1vdW50YCB0byBlYXJuaW5ncyBhbmQgaW5jcmVtZW50cyBjb21wbGV0ZWQgcHJvamVjdHMuCkVtaXRzIGAoZnJlZWxuY3IsIGVhcm5pbmdzKWAgYW5kIGAoZnJlZWxuY3IsIGNvbXBsZXRlZClgLgAAAAAAFXJlY29yZF9lc2Nyb3dfcmVsZWFzZQAAAAAAAAEAAAAAAAAACWVzY3Jvd19pZAAAAAAAAAYAAAABAAAD6QAAAAEAAAfQAAAAD0ZyZWVsYW5jZXJFcnJvcgA=", "AAAAAAAAADFTZXQgaWRlbnRpdHkgbWV0YWRhdGEgZm9yIHRoZSBhdXRoZW50aWNhdGVkIHVzZXIuAAAAAAAAFXNldF9pZGVudGl0eV9tZXRhZGF0YQAAAAAAAAIAAAAAAAAABHVzZXIAAAATAAAAAAAAAAhtZXRhZGF0YQAAA+wAAAAQAAAAEAAAAAEAAAAB", "AAAAAAAAADdSZXRyaWV2ZSB0aGUgdXNlciBhZGRyZXNzIGFzc29jaWF0ZWQgd2l0aCBhIHB1YmxpYyBrZXkuAAAAABZnZXRfdXNlcl9ieV9wdWJsaWNfa2V5AAAAAAABAAAAAAAAAApwdWJsaWNfa2V5AAAAAAAQAAAAAQAAA+gAAAAT", "AAAAAAAAAFJNYXAgYSBTdGVsbGFyIHB1YmxpYyBrZXkgdG8gYSB1c2VyIGFkZHJlc3MuIE9ubHkgdGhlIGNvbnRyYWN0IG93bmVyIG1heSBjYWxsIHRoaXMuAAAAAAAWc2V0X3B1YmxpY19rZXlfbWFwcGluZwAAAAAAAgAAAAAAAAAKcHVibGljX2tleQAAAAAAEAAAAAAAAAAEdXNlcgAAABMAAAABAAAD6QAAAAIAAAfQAAAAD0ZyZWVsYW5jZXJFcnJvcgA=", "AAAABAAAAK1FcnJvcnMgcmFpc2VkIGJ5IHRoZSBzaGFyZWQgdXBncmFkZS9hZG1pbiBoZWxwZXJzLgoKQ29kZXMgc3RhcnQgYXQgOTAwIHNvIHRoZXkgZG9uJ3Qgb3ZlcmxhcCBhbnkgY29udHJhY3QncyBvd24gZXJyb3IgZW51bTsKdGhleSBzdXJmYWNlIG9uLWNoYWluIGFzIGBFcnJvcihDb250cmFjdCwgIzl4eClgLgAAAAAAAAAAAAAMVXBncmFkZUVycm9yAAAABgAAAB9DYWxsZXIgaXMgbm90IHRoZSBzdG9yZWQgYWRtaW4uAAAAAAxVbmF1dGhvcml6ZWQAAAOEAAAAQWBleGVjdXRlX3VwZ3JhZGVgIC8gYGNhbmNlbF91cGdyYWRlYCBjYWxsZWQgd2l0aCBub3RoaW5nIHBlbmRpbmcuAAAAAAAAEE5vUGVuZGluZ1VwZ3JhZGUAAAOFAAAAMGBleGVjdXRlX3VwZ3JhZGVgIGNhbGxlZCBiZWZvcmUgYGV4ZWN1dGFibGVfYXRgLgAAABJUaW1lbG9ja05vdEVsYXBzZWQAAAAAA4YAAABFYGFjY2VwdF9hZG1pbmAgLyBgY2FuY2VsX2FkbWluX3RyYW5zZmVyYCBjYWxsZWQgd2l0aCBub3RoaW5nIHBlbmRpbmcuAAAAAAAADk5vUGVuZGluZ0FkbWluAAAAAAOHAAAAO2BhY2NlcHRfYWRtaW5gIHNpZ25lZCBieSBhbiBhZGRyZXNzIG90aGVyIHRoYW4gdGhlIG5vbWluZWUuAAAAAA9Ob3RQZW5kaW5nQWRtaW4AAAADiAAAACxgcHJvcG9zZV9hZG1pbmAgbm9taW5hdGVkIHRoZSBjdXJyZW50IGFkbWluLgAAAAlTYW1lQWRtaW4AAAAAAAOJ", "AAAAAQAAADFBIHByb3Bvc2VkIGNvZGUgdXBncmFkZSB3YWl0aW5nIG91dCBpdHMgdGltZWxvY2suAAAAAAAAAAAAAA5QZW5kaW5nVXBncmFkZQAAAAAAAwAAAAAAAAANZXhlY3V0YWJsZV9hdAAAAAAAAAYAAAAAAAAAC3Byb3Bvc2VkX2F0AAAAAAYAAAAAAAAACXdhc21faGFzaAAAAAAAA+4AAAAg"]),
      options
    );
  }

   static deploy<T = Client>(options: MethodOptions & Omit<ContractClientOptions, 'contractId'> & { wasmHash: Buffer | string; salt?: Buffer | Uint8Array; format?: "hex" | "base64"; address?: string; }): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options);
  }
  public readonly fromJSON = {
    initialize : this.txFromJSON<Result<null, FreelancerError>>,  get_profile : this.txFromJSON<Result<FreelancerProfile, FreelancerError>>,  is_verified : this.txFromJSON<boolean>,  accept_admin : this.txFromJSON<void>,  propose_admin : this.txFromJSON<void>,  update_rating : this.txFromJSON<Result<boolean, FreelancerError>>,  cancel_upgrade : this.txFromJSON<void>,  execute_upgrade : this.txFromJSON<void>,  propose_upgrade : this.txFromJSON<bigint>,  get_escrow_source : this.txFromJSON<string | null>,  get_pending_admin : this.txFromJSON<string | null>,  get_review_source : this.txFromJSON<string | null>,  set_escrow_source : this.txFromJSON<Result<null, FreelancerError>>,  set_review_source : this.txFromJSON<Result<null, FreelancerError>>,  verify_freelancer : this.txFromJSON<Result<boolean, FreelancerError>>,  is_escrow_credited : this.txFromJSON<boolean>,  get_pending_upgrade : this.txFromJSON<PendingUpgrade | null>,  migrate_reset_stats : this.txFromJSON<Result<boolean, FreelancerError>>,  register_freelancer : this.txFromJSON<boolean>,  cancel_admin_transfer : this.txFromJSON<void>,  get_freelancers_count : this.txFromJSON<number>,  get_identity_metadata : this.txFromJSON<Result<IdentityMetadata, FreelancerError>>,  record_escrow_release : this.txFromJSON<Result<boolean, FreelancerError>>,  set_identity_metadata : this.txFromJSON<boolean>,  get_user_by_public_key : this.txFromJSON<string | null>,  set_public_key_mapping : this.txFromJSON<Result<null, FreelancerError>>
  };

}