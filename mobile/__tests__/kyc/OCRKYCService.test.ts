import {
  computeCheckDigit,
  validateCheckDigit,
  detectMRZFormat,
  parseTD3MRZ,
  parseTD1MRZ,
  inferDocumentLayout,
  aggregateConfidence,
  StubOCRProvider,
  OCRKYCService,
  DEFAULT_CONFIDENCE_THRESHOLD,
  OCRTextBlock,
  MRZData,
} from '../../src/services/OCRKYCService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mkBlock = (text: string, confidence = 0.95): OCRTextBlock => ({
  text,
  confidence,
  boundingBox: { left: 0, top: 0, width: 100, height: 50 },
});

// Sample TD3 MRZ from ICAO Doc 9303 example
const TD3_LINE1 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<';
const TD3_LINE2 = 'L898902C36UTO7408122F1204159ZE184226B<<<<<10';

// Sample TD1 MRZ
const TD1_LINE1 = 'I<UTOD231458907<<<<<<<<<<<<<<<';
const TD1_LINE2 = '7408122F1204159UTO<<<<<<<<<<<6';
const TD1_LINE3 = 'ERIKSSON<<ANNA<MARIA<<<<<<<<<<';

// ─── computeCheckDigit ────────────────────────────────────────────────────────

describe('computeCheckDigit', () => {
  it('computes check digit for ICAO example "520727"', () => {
    // From ICAO Doc 9303 Part 3: "520727" -> 3
    expect(computeCheckDigit('520727')).toBe(3);
  });

  it('handles empty string without throwing', () => {
    expect(() => computeCheckDigit('')).not.toThrow();
  });

  it('handles all-filler string', () => {
    expect(typeof computeCheckDigit('<<<<<<')).toBe('number');
  });
});

// ─── validateCheckDigit ───────────────────────────────────────────────────────

describe('validateCheckDigit', () => {
  it('returns false for string shorter than 2 characters', () => {
    expect(validateCheckDigit('5')).toBe(false);
  });

  it('returns false when check digit character is not a digit', () => {
    expect(validateCheckDigit('5207X')).toBe(false);
  });
});

// ─── detectMRZFormat ──────────────────────────────────────────────────────────

describe('detectMRZFormat', () => {
  it('detects TD3 from two 44-char lines', () => {
    expect(detectMRZFormat([TD3_LINE1, TD3_LINE2])).toBe('TD3');
  });

  it('detects TD1 from three 30-char lines', () => {
    expect(detectMRZFormat([TD1_LINE1, TD1_LINE2, TD1_LINE3])).toBe('TD1');
  });

  it('returns null when line lengths do not match any format', () => {
    expect(detectMRZFormat(['HELLO', 'WORLD'])).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(detectMRZFormat([])).toBeNull();
  });

  it('returns null when correct number of lines but wrong length', () => {
    expect(detectMRZFormat(['P<UTOERIKSSON', 'L898902C36'])).toBeNull();
  });
});

// ─── parseTD3MRZ ─────────────────────────────────────────────────────────────

describe('parseTD3MRZ', () => {
  let mrz: MRZData;
  beforeEach(() => { mrz = parseTD3MRZ(TD3_LINE1, TD3_LINE2); });

  it('parses document type', () => expect(mrz.documentType).toBe('P'));
  it('parses issuing country', () => expect(mrz.issuingCountry).toBe('UTO'));
  it('parses surname', () => expect(mrz.surname).toBe('ERIKSSON'));
  it('parses given names', () => expect(mrz.givenNames).toContain('ANNA'));
  it('parses nationality', () => expect(mrz.nationality).toBe('UTO'));
  it('parses sex', () => expect(mrz.sex).toBe('F'));
  it('parses date of birth', () => expect(mrz.dateOfBirth).toBe('740812'));
  it('parses date of expiry', () => expect(mrz.dateOfExpiry).toBe('120415'));
  it('returns format TD3', () => expect(mrz.format).toBe('TD3'));

  it('throws for lines that are not 44 chars', () => {
    expect(() => parseTD3MRZ('SHORT', TD3_LINE2)).toThrow();
  });
});

// ─── parseTD1MRZ ─────────────────────────────────────────────────────────────

describe('parseTD1MRZ', () => {
  let mrz: MRZData;
  beforeEach(() => { mrz = parseTD1MRZ(TD1_LINE1, TD1_LINE2, TD1_LINE3); });

  it('parses issuing country', () => expect(mrz.issuingCountry).toBe('UTO'));
  it('parses document number', () => expect(mrz.documentNumber).toBe('D23145890'));
  it('parses sex', () => expect(mrz.sex).toBe('F'));
  it('parses nationality', () => expect(mrz.nationality).toBe('UTO'));
  it('parses surname', () => expect(mrz.surname).toBe('ERIKSSON'));
  it('returns format TD1', () => expect(mrz.format).toBe('TD1'));

  it('throws for lines that are not 30 chars', () => {
    expect(() => parseTD1MRZ('SHORT', TD1_LINE2, TD1_LINE3)).toThrow();
  });
});

// ─── aggregateConfidence ──────────────────────────────────────────────────────

describe('aggregateConfidence', () => {
  it('returns 0 for empty array', () => {
    expect(aggregateConfidence([])).toBe(0);
  });

  it('returns the single block confidence', () => {
    expect(aggregateConfidence([mkBlock('HELLO', 0.9)])).toBe(0.9);
  });

  it('returns the mean of multiple blocks', () => {
    const blocks = [mkBlock('A', 0.8), mkBlock('B', 0.6)];
    expect(aggregateConfidence(blocks)).toBeCloseTo(0.7);
  });
});

// ─── inferDocumentLayout ──────────────────────────────────────────────────────

describe('inferDocumentLayout', () => {
  it('detects MRZ zone from TD3 lines', () => {
    const blocks = [mkBlock(TD3_LINE1), mkBlock(TD3_LINE2)];
    const layout = inferDocumentLayout(blocks);
    expect(layout.hasMRZZone).toBe(true);
  });

  it('estimates passport type when first MRZ line starts with P and has length 44', () => {
    const blocks = [mkBlock(TD3_LINE1), mkBlock(TD3_LINE2)];
    const layout = inferDocumentLayout(blocks);
    expect(layout.estimatedType).toBe('passport');
  });

  it('estimates national_id type for TD1 (30-char) lines', () => {
    const blocks = [mkBlock(TD1_LINE1), mkBlock(TD1_LINE2), mkBlock(TD1_LINE3)];
    const layout = inferDocumentLayout(blocks);
    expect(layout.estimatedType).toBe('national_id');
  });

  it('sets hasPhotoZone true when blocks have a bounding box', () => {
    const layout = inferDocumentLayout([mkBlock('ANY')]);
    expect(layout.hasPhotoZone).toBe(true);
  });

  it('hasMRZZone is false when no MRZ-pattern lines are present', () => {
    const layout = inferDocumentLayout([mkBlock('Hello World')]);
    expect(layout.hasMRZZone).toBe(false);
  });
});

// ─── OCRKYCService ────────────────────────────────────────────────────────────

describe('OCRKYCService', () => {
  it('returns success for valid TD3 document with high confidence', async () => {
    const blocks = [
      mkBlock(TD3_LINE1, 0.95),
      mkBlock(TD3_LINE2, 0.95),
    ];
    const service = new OCRKYCService(new StubOCRProvider(blocks));
    const result = await service.scan('base64image');
    expect(result.status).toBe('success');
    expect(result.mrz?.format).toBe('TD3');
    expect(result.mrz?.surname).toBe('ERIKSSON');
  });

  it('returns low_confidence when mean confidence is below threshold', async () => {
    const blocks = [mkBlock(TD3_LINE1, 0.3), mkBlock(TD3_LINE2, 0.3)];
    const service = new OCRKYCService(new StubOCRProvider(blocks));
    const result = await service.scan('img');
    expect(result.status).toBe('low_confidence');
    expect(result.rejectionReason).toMatch(/below threshold/);
  });

  it('returns unsupported_document when no MRZ zone detected', async () => {
    const blocks = [mkBlock('Name: John Doe', 0.99), mkBlock('DOB: 1990-01-01', 0.99)];
    const service = new OCRKYCService(new StubOCRProvider(blocks));
    const result = await service.scan('img');
    expect(result.status).toBe('unsupported_document');
  });

  it('returns error when provider throws', async () => {
    const failingProvider = {
      recognizeDocument: async () => { throw new Error('camera unavailable'); },
    };
    const service = new OCRKYCService(failingProvider);
    const result = await service.scan('img');
    expect(result.status).toBe('error');
    expect(result.rejectionReason).toMatch(/camera unavailable/);
  });

  it('honours custom confidence threshold', async () => {
    const blocks = [mkBlock(TD3_LINE1, 0.75), mkBlock(TD3_LINE2, 0.75)];
    // Set threshold below 0.75 so scan should succeed
    const service = new OCRKYCService(new StubOCRProvider(blocks), 0.5);
    const result = await service.scan('img');
    // MRZ lines are high-quality so should parse
    expect(['success', 'invalid_mrz']).toContain(result.status);
  });

  it('exposes default confidence threshold constant', () => {
    expect(DEFAULT_CONFIDENCE_THRESHOLD).toBeGreaterThan(0);
    expect(DEFAULT_CONFIDENCE_THRESHOLD).toBeLessThanOrEqual(1);
  });

  it('result always contains scannedAt timestamp', async () => {
    const before = Date.now();
    const service = new OCRKYCService(new StubOCRProvider([]));
    const result = await service.scan('img');
    expect(result.scannedAt).toBeGreaterThanOrEqual(before);
  });

  it('result always contains rawBlocks', async () => {
    const blocks = [mkBlock('test', 0.5)];
    const service = new OCRKYCService(new StubOCRProvider(blocks));
    const result = await service.scan('img');
    expect(result.rawBlocks).toHaveLength(1);
  });
});
