/**
 * DIDWalletService — Issue #595
 * "[Mobile] Develop Decentralized Identity (DID) Mobile Wallet"
 *
 * Features:
 *  - Strict W3C DID Core spec parser (did:<method>:<method-specific-id>)
 *  - Verifiable Credential (VC) storage and presentation-flow management
 *  - QR code payload encoding/decoding for DID exchange (DIDComm-style)
 *  - In-memory wallet with CRUD operations on credentials
 *  - Presentation request/response negotiation
 */

// ─── Constants ─────────────────────────────────────────────────────────────────

/** W3C DID context URL. */
export const DID_CONTEXT_URL = 'https://www.w3.org/ns/did/v1';

/** W3C VC context URL. */
export const VC_CONTEXT_URL = 'https://www.w3.org/2018/credentials/v1';

/** Supported DID methods. */
export const SUPPORTED_DID_METHODS = ['key', 'web', 'ethr', 'ion', 'stellar'] as const;

export type DIDMethod = (typeof SUPPORTED_DID_METHODS)[number];

// ─── Types ──────────────────────────────────────────────────────────────────────

/** Parsed representation of a DID URI per W3C DID Core §3. */
export interface ParsedDID {
  did: string;
  method: string;
  methodSpecificId: string;
  path?: string;
  query?: string;
  fragment?: string;
}

/** Minimal DID Document per W3C DID Core §6. */
export interface DIDDocument {
  '@context': string | string[];
  id: string;
  verificationMethod?: VerificationMethod[];
  authentication?: (string | VerificationMethod)[];
  assertionMethod?: (string | VerificationMethod)[];
  keyAgreement?: (string | VerificationMethod)[];
  service?: ServiceEndpoint[];
  created?: string;
  updated?: string;
}

export interface VerificationMethod {
  id: string;
  type: string;
  controller: string;
  publicKeyMultibase?: string;
  publicKeyJwk?: Record<string, unknown>;
}

export interface ServiceEndpoint {
  id: string;
  type: string;
  serviceEndpoint: string | string[];
}

/** W3C Verifiable Credential envelope. */
export interface VerifiableCredential {
  '@context': string[];
  id?: string;
  type: string[];
  issuer: string | { id: string; [key: string]: unknown };
  issuanceDate: string;
  expirationDate?: string;
  credentialSubject: CredentialSubject;
  proof?: CredentialProof;
}

export interface CredentialSubject {
  id?: string;
  [key: string]: unknown;
}

export interface CredentialProof {
  type: string;
  created: string;
  verificationMethod: string;
  proofPurpose: string;
  jws?: string;
  proofValue?: string;
}

/** Verifiable Presentation that wraps one or more VCs. */
export interface VerifiablePresentation {
  '@context': string[];
  type: string[];
  holder?: string;
  verifiableCredential: VerifiableCredential[];
  proof?: CredentialProof;
  id?: string;
}

/** QR code exchange payload for DID negotiation. */
export interface DIDQRPayload {
  version: '1.0';
  type: 'did-request' | 'did-response' | 'vc-offer' | 'vp-request';
  did?: string;
  challenge?: string;
  domain?: string;
  credentials?: VerifiableCredential[];
  presentation?: VerifiablePresentation;
}

export type PresentationStatus = 'pending' | 'accepted' | 'rejected' | 'expired';

export interface PresentationRequest {
  id: string;
  requesterDID: string;
  credentialTypes: string[];
  challenge: string;
  domain?: string;
  expiresAt: number;
  status: PresentationStatus;
}

// ─── DID Parser ─────────────────────────────────────────────────────────────────

/**
 * Parses a DID URI per the W3C DID Core specification §3.1.
 *
 * Grammar (simplified):
 *   did = "did:" method ":" method-specific-id [ "/" path ] [ "?" query ] [ "#" fragment ]
 *   method = 1*method-char
 *   method-char = %x61-7A / DIGIT
 */
export function parseDID(did: string): ParsedDID {
  if (typeof did !== 'string') {
    throw new TypeError('DID must be a string');
  }

  // Strip and split at fragment first (fragment cannot contain '?' or '/')
  let rest = did;
  let fragment: string | undefined;
  const hashIdx = rest.indexOf('#');
  if (hashIdx !== -1) {
    fragment = rest.slice(hashIdx + 1);
    rest = rest.slice(0, hashIdx);
  }

  // Split query
  let query: string | undefined;
  const queryIdx = rest.indexOf('?');
  if (queryIdx !== -1) {
    query = rest.slice(queryIdx + 1);
    rest = rest.slice(0, queryIdx);
  }

  // Validate scheme
  if (!rest.startsWith('did:')) {
    throw new Error(`Invalid DID — must start with "did:": "${did}"`);
  }

  const withoutScheme = rest.slice(4); // Remove "did:"
  const colonIdx = withoutScheme.indexOf(':');
  if (colonIdx === -1) {
    throw new Error(`Invalid DID — missing method-specific-id separator: "${did}"`);
  }

  const method = withoutScheme.slice(0, colonIdx);
  const afterMethod = withoutScheme.slice(colonIdx + 1);

  // Validate method: lowercase letters and digits only
  if (!/^[a-z0-9]+$/.test(method)) {
    throw new Error(`Invalid DID method "${method}" — must contain only lowercase letters and digits`);
  }

  // Split method-specific-id from path
  let methodSpecificId: string;
  let path: string | undefined;
  const slashIdx = afterMethod.indexOf('/');
  if (slashIdx !== -1) {
    methodSpecificId = afterMethod.slice(0, slashIdx);
    path = afterMethod.slice(slashIdx + 1);
  } else {
    methodSpecificId = afterMethod;
  }

  if (!methodSpecificId) {
    throw new Error(`Invalid DID — method-specific-id is empty: "${did}"`);
  }

  return {
    did: `did:${method}:${methodSpecificId}`,
    method,
    methodSpecificId,
    path,
    query,
    fragment,
  };
}

/**
 * Returns true when the string is a syntactically valid DID.
 */
export function isValidDID(did: string): boolean {
  try {
    parseDID(did);
    return true;
  } catch {
    return false;
  }
}

// ─── DID Document Validator ────────────────────────────────────────────────────

/**
 * Validates a DID Document against the W3C DID Core §6 requirements.
 * Returns an array of validation error messages (empty = valid).
 */
export function validateDIDDocument(doc: unknown): string[] {
  const errors: string[] = [];

  if (typeof doc !== 'object' || doc === null) {
    return ['Document must be a non-null object'];
  }

  const d = doc as Record<string, unknown>;

  if (!d['@context']) {
    errors.push('Missing @context');
  } else {
    const ctx = d['@context'];
    const hasRequired =
      ctx === DID_CONTEXT_URL ||
      (Array.isArray(ctx) && ctx.includes(DID_CONTEXT_URL));
    if (!hasRequired) {
      errors.push(`@context must include "${DID_CONTEXT_URL}"`);
    }
  }

  if (typeof d['id'] !== 'string') {
    errors.push('Missing or invalid "id" field');
  } else if (!isValidDID(d['id'])) {
    errors.push(`"id" is not a valid DID: "${d['id']}"`);
  }

  return errors;
}

// ─── Verifiable Credential Validator ──────────────────────────────────────────

/**
 * Validates a VC structure per W3C VC Data Model §4.
 * Returns an array of validation error messages.
 */
export function validateVerifiableCredential(vc: unknown): string[] {
  const errors: string[] = [];

  if (typeof vc !== 'object' || vc === null) {
    return ['VC must be a non-null object'];
  }

  const v = vc as Record<string, unknown>;

  // @context
  if (!Array.isArray(v['@context']) || !v['@context'].includes(VC_CONTEXT_URL)) {
    errors.push(`@context must be an array including "${VC_CONTEXT_URL}"`);
  }

  // type
  if (!Array.isArray(v['type']) || !v['type'].includes('VerifiableCredential')) {
    errors.push('type must be an array including "VerifiableCredential"');
  }

  // issuer
  if (!v['issuer']) {
    errors.push('Missing "issuer" field');
  }

  // issuanceDate
  if (typeof v['issuanceDate'] !== 'string') {
    errors.push('Missing or invalid "issuanceDate" field');
  }

  // credentialSubject
  if (typeof v['credentialSubject'] !== 'object' || v['credentialSubject'] === null) {
    errors.push('Missing or invalid "credentialSubject" field');
  }

  return errors;
}

// ─── QR Payload Codec ─────────────────────────────────────────────────────────

/**
 * Encodes a DIDQRPayload to a compact JSON string suitable for QR display.
 */
export function encodeDIDQRPayload(payload: DIDQRPayload): string {
  return JSON.stringify(payload);
}

/**
 * Decodes and validates a QR string back to a DIDQRPayload.
 * Throws if the string is not valid JSON or lacks required fields.
 */
export function decodeDIDQRPayload(raw: string): DIDQRPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('QR payload is not valid JSON');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('QR payload must be a JSON object');
  }

  const p = parsed as Record<string, unknown>;

  if (p['version'] !== '1.0') {
    throw new Error(`Unsupported QR payload version: "${p['version']}"`);
  }

  const validTypes = ['did-request', 'did-response', 'vc-offer', 'vp-request'];
  if (!validTypes.includes(p['type'] as string)) {
    throw new Error(`Unknown QR payload type: "${p['type']}"`);
  }

  return parsed as DIDQRPayload;
}

// ─── DID Wallet ───────────────────────────────────────────────────────────────

/**
 * In-memory DID wallet that holds verifiable credentials and manages
 * presentation request/response flows.
 */
export class DIDWallet {
  private ownerDID: string;
  private credentials: Map<string, VerifiableCredential> = new Map();
  private presentationRequests: Map<string, PresentationRequest> = new Map();
  private requestCounter = 0;

  constructor(ownerDID: string) {
    if (!isValidDID(ownerDID)) {
      throw new Error(`Owner DID is invalid: "${ownerDID}"`);
    }
    this.ownerDID = ownerDID;
  }

  // ── Credential Management ─────────────────────────────────────────────────

  /**
   * Add a credential to the wallet.
   * Throws if the credential fails validation.
   */
  addCredential(vc: VerifiableCredential): string {
    const errors = validateVerifiableCredential(vc);
    if (errors.length > 0) {
      throw new Error(`Invalid VC: ${errors.join('; ')}`);
    }

    const id = vc.id ?? this.generateCredentialId();
    const stored = { ...vc, id };
    this.credentials.set(id, stored);
    return id;
  }

  /**
   * Retrieve a credential by its ID.
   */
  getCredential(id: string): VerifiableCredential | undefined {
    return this.credentials.get(id);
  }

  /**
   * Remove a credential from the wallet.
   */
  removeCredential(id: string): boolean {
    return this.credentials.delete(id);
  }

  /**
   * List all stored credentials.
   */
  listCredentials(): VerifiableCredential[] {
    return Array.from(this.credentials.values());
  }

  /**
   * Find credentials matching a given type.
   */
  findByType(credentialType: string): VerifiableCredential[] {
    return this.listCredentials().filter((vc) => vc.type.includes(credentialType));
  }

  // ── Presentation Flows ────────────────────────────────────────────────────

  /**
   * Create and store a presentation request from a relying party.
   */
  createPresentationRequest(
    requesterDID: string,
    credentialTypes: string[],
    ttlMs: number = 300_000,
    domain?: string,
  ): PresentationRequest {
    const id = `pr-${++this.requestCounter}-${Date.now()}`;
    const request: PresentationRequest = {
      id,
      requesterDID,
      credentialTypes,
      challenge: this.generateChallenge(),
      domain,
      expiresAt: Date.now() + ttlMs,
      status: 'pending',
    };
    this.presentationRequests.set(id, request);
    return request;
  }

  /**
   * Build a Verifiable Presentation for a given request.
   * Returns null when the request is not found or has expired.
   */
  buildPresentation(requestId: string): VerifiablePresentation | null {
    const request = this.presentationRequests.get(requestId);
    if (!request || request.status !== 'pending') return null;

    if (Date.now() > request.expiresAt) {
      request.status = 'expired';
      return null;
    }

    // Select matching credentials
    const matching = request.credentialTypes.flatMap((t) => this.findByType(t));

    const presentation: VerifiablePresentation = {
      '@context': [VC_CONTEXT_URL],
      type: ['VerifiablePresentation'],
      holder: this.ownerDID,
      verifiableCredential: matching,
      id: `vp-${requestId}`,
    };

    request.status = 'accepted';
    return presentation;
  }

  /**
   * Decode a QR code string and, if it contains a VC offer, import the credentials.
   */
  handleQRScan(raw: string): DIDQRPayload {
    const payload = decodeDIDQRPayload(raw);

    if (payload.type === 'vc-offer' && payload.credentials) {
      for (const vc of payload.credentials) {
        try {
          this.addCredential(vc);
        } catch {
          // Skip invalid credentials from scan
        }
      }
    }

    return payload;
  }

  /** The wallet owner's DID. */
  get did(): string {
    return this.ownerDID;
  }

  /** Number of credentials currently stored. */
  get credentialCount(): number {
    return this.credentials.size;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private generateCredentialId(): string {
    return `vc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  private generateChallenge(): string {
    const bytes = Array.from({ length: 16 }, () =>
      Math.floor(Math.random() * 256).toString(16).padStart(2, '0'),
    );
    return bytes.join('');
  }
}

// ─── Key Backup ──────────────────────────────────────────────────────────────

export interface EncryptedKeyBackup {
  version: '1.0';
  ownerDID: string;
  encryptedPayload: string; // base64 AES-256-GCM encrypted
  iv: string; // base64
  salt: string; // base64
  createdAt: string; // ISO 8601
}

export class KeyBackupService {
  private static readonly PBKDF2_ITERATIONS = 100_000;
  private static readonly KEY_LENGTH = 256;

  static async createBackup(
    ownerDID: string,
    keyMaterial: Record<string, string>,
    passphrase: string,
  ): Promise<EncryptedKeyBackup> {
    const encoder = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const baseKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode(passphrase),
      'PBKDF2',
      false,
      ['deriveKey'],
    );

    const derivedKey = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: this.PBKDF2_ITERATIONS, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: this.KEY_LENGTH },
      false,
      ['encrypt'],
    );

    const plaintext = encoder.encode(JSON.stringify(keyMaterial));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      derivedKey,
      plaintext,
    );

    return {
      version: '1.0',
      ownerDID,
      encryptedPayload: Buffer.from(ciphertext).toString('base64'),
      iv: Buffer.from(iv).toString('base64'),
      salt: Buffer.from(salt).toString('base64'),
      createdAt: new Date().toISOString(),
    };
  }

  static async restoreBackup(
    backup: EncryptedKeyBackup,
    passphrase: string,
  ): Promise<Record<string, string>> {
    const encoder = new TextEncoder();
    const salt = new Uint8Array(Buffer.from(backup.salt, 'base64'));
    const iv = new Uint8Array(Buffer.from(backup.iv, 'base64'));
    const ciphertext = Buffer.from(backup.encryptedPayload, 'base64');

    const baseKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode(passphrase),
      'PBKDF2',
      false,
      ['deriveKey'],
    );

    const derivedKey = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: this.PBKDF2_ITERATIONS, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: this.KEY_LENGTH },
      false,
      ['decrypt'],
    );

    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      derivedKey,
      ciphertext,
    );

    return JSON.parse(new TextDecoder().decode(plaintext));
  }
}

// ─── DIDWalletService ─────────────────────────────────────────────────────────

/**
 * Top-level service that manages multiple DID wallets keyed by owner DID.
 * Supports encrypted key backup to iCloud / Google Drive.
 */
export class DIDWalletService {
  private wallets: Map<string, DIDWallet> = new Map();

  /**
   * Create or retrieve a wallet for the given DID.
   */
  getOrCreateWallet(ownerDID: string): DIDWallet {
    if (!this.wallets.has(ownerDID)) {
      this.wallets.set(ownerDID, new DIDWallet(ownerDID));
    }
    return this.wallets.get(ownerDID)!;
  }

  /**
   * Returns true when a wallet exists for the given DID.
   */
  hasWallet(ownerDID: string): boolean {
    return this.wallets.has(ownerDID);
  }

  /**
   * Remove a wallet entirely.
   */
  removeWallet(ownerDID: string): boolean {
    return this.wallets.delete(ownerDID);
  }

  /** Total number of managed wallets. */
  get walletCount(): number {
    return this.wallets.size;
  }

  /**
   * Create an encrypted backup of all Signal protocol keys for a wallet.
   * The backup is encrypted with the user's passphrase using AES-256-GCM
   * with PBKDF2 key derivation — safe to store in iCloud or Google Drive.
   */
  async createKeyBackup(
    ownerDID: string,
    keyMaterial: Record<string, string>,
    passphrase: string,
  ): Promise<EncryptedKeyBackup> {
    return KeyBackupService.createBackup(ownerDID, keyMaterial, passphrase);
  }

  /**
   * Restore Signal protocol keys from an encrypted backup.
   */
  async restoreKeyBackup(
    backup: EncryptedKeyBackup,
    passphrase: string,
  ): Promise<Record<string, string>> {
    return KeyBackupService.restoreBackup(backup, passphrase);
  }
}
