import {
  parseDID,
  isValidDID,
  validateDIDDocument,
  validateVerifiableCredential,
  encodeDIDQRPayload,
  decodeDIDQRPayload,
  DIDWallet,
  DIDWalletService,
  DID_CONTEXT_URL,
  VC_CONTEXT_URL,
  VerifiableCredential,
  DIDQRPayload,
} from '../../src/services/DIDWalletService';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VALID_DID = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK';
const VALID_DID_WEB = 'did:web:example.com';
const VALID_DID_STELLAR = 'did:stellar:GXXXXXXXXXXXXXXXXXXXXXX';

const makeVC = (overrides: Partial<VerifiableCredential> = {}): VerifiableCredential => ({
  '@context': [VC_CONTEXT_URL],
  type: ['VerifiableCredential', 'UniversityDegreeCredential'],
  issuer: VALID_DID,
  issuanceDate: '2024-01-01T00:00:00Z',
  credentialSubject: {
    id: VALID_DID_WEB,
    degree: { type: 'BachelorDegree', name: 'Computer Science' },
  },
  ...overrides,
});

// ─── parseDID ─────────────────────────────────────────────────────────────────

describe('parseDID', () => {
  it('parses a did:key DID', () => {
    const result = parseDID(VALID_DID);
    expect(result.method).toBe('key');
    expect(result.did).toContain('did:key:');
  });

  it('parses a did:web DID', () => {
    const result = parseDID(VALID_DID_WEB);
    expect(result.method).toBe('web');
    expect(result.methodSpecificId).toBe('example.com');
  });

  it('parses fragment', () => {
    const result = parseDID(`${VALID_DID}#key-1`);
    expect(result.fragment).toBe('key-1');
  });

  it('parses query string', () => {
    const result = parseDID(`${VALID_DID_WEB}?service=hub`);
    expect(result.query).toBe('service=hub');
  });

  it('parses path component', () => {
    const result = parseDID('did:web:example.com/users/alice');
    expect(result.path).toBe('users/alice');
  });

  it('throws when string does not start with "did:"', () => {
    expect(() => parseDID('http://example.com')).toThrow();
  });

  it('throws when method is missing', () => {
    expect(() => parseDID('did:')).toThrow();
  });

  it('throws when method contains uppercase', () => {
    expect(() => parseDID('did:Key:abc123')).toThrow();
  });

  it('throws when method-specific-id is empty', () => {
    expect(() => parseDID('did:key:')).toThrow();
  });

  it('throws for non-string input', () => {
    expect(() => parseDID(42 as unknown as string)).toThrow();
  });
});

// ─── isValidDID ───────────────────────────────────────────────────────────────

describe('isValidDID', () => {
  it('returns true for valid DID', () => expect(isValidDID(VALID_DID)).toBe(true));
  it('returns false for non-DID string', () => expect(isValidDID('not-a-did')).toBe(false));
  it('returns false for empty string', () => expect(isValidDID('')).toBe(false));
  it('returns true for stellar DID', () => expect(isValidDID(VALID_DID_STELLAR)).toBe(true));
});

// ─── validateDIDDocument ──────────────────────────────────────────────────────

describe('validateDIDDocument', () => {
  it('returns empty errors for valid document', () => {
    const doc = {
      '@context': [DID_CONTEXT_URL],
      id: VALID_DID,
    };
    expect(validateDIDDocument(doc)).toHaveLength(0);
  });

  it('reports error for missing @context', () => {
    const errors = validateDIDDocument({ id: VALID_DID });
    expect(errors.some((e) => e.includes('@context'))).toBe(true);
  });

  it('reports error when @context does not include required URL', () => {
    const errors = validateDIDDocument({ '@context': ['https://schema.org'], id: VALID_DID });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('reports error for missing id', () => {
    const errors = validateDIDDocument({ '@context': [DID_CONTEXT_URL] });
    expect(errors.some((e) => e.includes('"id"'))).toBe(true);
  });

  it('reports error for invalid DID in id', () => {
    const errors = validateDIDDocument({ '@context': [DID_CONTEXT_URL], id: 'not-a-did' });
    expect(errors.some((e) => e.includes('valid DID'))).toBe(true);
  });

  it('returns error for null input', () => {
    expect(validateDIDDocument(null)).toHaveLength(1);
  });
});

// ─── validateVerifiableCredential ─────────────────────────────────────────────

describe('validateVerifiableCredential', () => {
  it('returns empty errors for valid VC', () => {
    expect(validateVerifiableCredential(makeVC())).toHaveLength(0);
  });

  it('reports error when @context is missing VC URL', () => {
    const errors = validateVerifiableCredential(makeVC({ '@context': ['https://schema.org'] }));
    expect(errors.some((e) => e.includes('@context'))).toBe(true);
  });

  it('reports error when type is missing VerifiableCredential', () => {
    const errors = validateVerifiableCredential(makeVC({ type: ['CustomType'] }));
    expect(errors.some((e) => e.includes('type'))).toBe(true);
  });

  it('reports error for missing issuer', () => {
    const vc = makeVC();
    const { issuer: _i, ...withoutIssuer } = vc;
    const errors = validateVerifiableCredential(withoutIssuer);
    expect(errors.some((e) => e.includes('issuer'))).toBe(true);
  });

  it('reports error for missing issuanceDate', () => {
    const vc = makeVC();
    const { issuanceDate: _d, ...without } = vc;
    const errors = validateVerifiableCredential(without);
    expect(errors.some((e) => e.includes('issuanceDate'))).toBe(true);
  });

  it('reports error for null input', () => {
    expect(validateVerifiableCredential(null)).toHaveLength(1);
  });
});

// ─── QR Codec ─────────────────────────────────────────────────────────────────

describe('encodeDIDQRPayload / decodeDIDQRPayload', () => {
  const payload: DIDQRPayload = {
    version: '1.0',
    type: 'did-request',
    did: VALID_DID,
    challenge: 'abc123',
  };

  it('round-trips a payload', () => {
    const encoded = encodeDIDQRPayload(payload);
    const decoded = decodeDIDQRPayload(encoded);
    expect(decoded.did).toBe(VALID_DID);
    expect(decoded.type).toBe('did-request');
  });

  it('throws for non-JSON input', () => {
    expect(() => decodeDIDQRPayload('not json')).toThrow();
  });

  it('throws for unsupported version', () => {
    expect(() =>
      decodeDIDQRPayload(JSON.stringify({ version: '2.0', type: 'did-request' })),
    ).toThrow(/version/i);
  });

  it('throws for unknown type', () => {
    expect(() =>
      decodeDIDQRPayload(JSON.stringify({ version: '1.0', type: 'unknown-type' })),
    ).toThrow(/type/i);
  });
});

// ─── DIDWallet ────────────────────────────────────────────────────────────────

describe('DIDWallet', () => {
  let wallet: DIDWallet;
  beforeEach(() => { wallet = new DIDWallet(VALID_DID); });

  it('throws for invalid owner DID', () => {
    expect(() => new DIDWallet('bad-did')).toThrow();
  });

  it('exposes owner DID', () => {
    expect(wallet.did).toBe(VALID_DID);
  });

  it('starts with zero credentials', () => {
    expect(wallet.credentialCount).toBe(0);
  });

  it('adds a valid credential', () => {
    const id = wallet.addCredential(makeVC());
    expect(typeof id).toBe('string');
    expect(wallet.credentialCount).toBe(1);
  });

  it('rejects an invalid credential', () => {
    expect(() => wallet.addCredential({} as VerifiableCredential)).toThrow();
  });

  it('retrieves credential by id', () => {
    const id = wallet.addCredential(makeVC());
    const vc = wallet.getCredential(id);
    expect(vc).toBeDefined();
    expect(vc?.type).toContain('VerifiableCredential');
  });

  it('removes credential by id', () => {
    const id = wallet.addCredential(makeVC());
    expect(wallet.removeCredential(id)).toBe(true);
    expect(wallet.credentialCount).toBe(0);
  });

  it('lists all credentials', () => {
    wallet.addCredential(makeVC());
    wallet.addCredential(makeVC({ id: 'vc-2' }));
    expect(wallet.listCredentials()).toHaveLength(2);
  });

  it('findByType returns matching credentials', () => {
    wallet.addCredential(makeVC({ type: ['VerifiableCredential', 'UniversityDegreeCredential'] }));
    wallet.addCredential(makeVC({ type: ['VerifiableCredential', 'DriversLicenseCredential'] }));
    const degrees = wallet.findByType('UniversityDegreeCredential');
    expect(degrees).toHaveLength(1);
  });

  it('createPresentationRequest returns pending request with challenge', () => {
    const req = wallet.createPresentationRequest(VALID_DID_WEB, ['UniversityDegreeCredential']);
    expect(req.status).toBe('pending');
    expect(req.challenge).toBeTruthy();
    expect(req.credentialTypes).toContain('UniversityDegreeCredential');
  });

  it('buildPresentation assembles matching credentials', () => {
    wallet.addCredential(makeVC({ type: ['VerifiableCredential', 'UniversityDegreeCredential'] }));
    const req = wallet.createPresentationRequest(VALID_DID_WEB, ['UniversityDegreeCredential']);
    const vp = wallet.buildPresentation(req.id);
    expect(vp).not.toBeNull();
    expect(vp?.holder).toBe(VALID_DID);
    expect(vp?.verifiableCredential).toHaveLength(1);
  });

  it('buildPresentation returns null for unknown request id', () => {
    expect(wallet.buildPresentation('unknown-id')).toBeNull();
  });

  it('buildPresentation returns null for expired request', () => {
    const req = wallet.createPresentationRequest(VALID_DID_WEB, ['SomeType'], -1); // already expired
    const vp = wallet.buildPresentation(req.id);
    expect(vp).toBeNull();
  });

  it('handleQRScan imports credentials from vc-offer payload', () => {
    const payload: DIDQRPayload = {
      version: '1.0',
      type: 'vc-offer',
      credentials: [makeVC({ id: 'vc-from-qr' })],
    };
    wallet.handleQRScan(encodeDIDQRPayload(payload));
    expect(wallet.getCredential('vc-from-qr')).toBeDefined();
  });

  it('handleQRScan returns the decoded payload', () => {
    const payload: DIDQRPayload = { version: '1.0', type: 'did-request', did: VALID_DID_WEB };
    const result = wallet.handleQRScan(encodeDIDQRPayload(payload));
    expect(result.type).toBe('did-request');
  });
});

// ─── DIDWalletService ─────────────────────────────────────────────────────────

describe('DIDWalletService', () => {
  it('creates a new wallet on first access', () => {
    const svc = new DIDWalletService();
    const wallet = svc.getOrCreateWallet(VALID_DID);
    expect(wallet.did).toBe(VALID_DID);
    expect(svc.walletCount).toBe(1);
  });

  it('returns the same wallet on subsequent calls', () => {
    const svc = new DIDWalletService();
    const a = svc.getOrCreateWallet(VALID_DID);
    const b = svc.getOrCreateWallet(VALID_DID);
    expect(a).toBe(b);
  });

  it('hasWallet returns false before creation', () => {
    const svc = new DIDWalletService();
    expect(svc.hasWallet(VALID_DID)).toBe(false);
  });

  it('hasWallet returns true after creation', () => {
    const svc = new DIDWalletService();
    svc.getOrCreateWallet(VALID_DID);
    expect(svc.hasWallet(VALID_DID)).toBe(true);
  });

  it('removeWallet deletes the wallet', () => {
    const svc = new DIDWalletService();
    svc.getOrCreateWallet(VALID_DID);
    svc.removeWallet(VALID_DID);
    expect(svc.hasWallet(VALID_DID)).toBe(false);
    expect(svc.walletCount).toBe(0);
  });

  it('manages multiple wallets independently', () => {
    const svc = new DIDWalletService();
    svc.getOrCreateWallet(VALID_DID);
    svc.getOrCreateWallet(VALID_DID_STELLAR);
    expect(svc.walletCount).toBe(2);
  });
});
