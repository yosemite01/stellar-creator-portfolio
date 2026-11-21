import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  computeRawCidV1,
  isValidCid,
  parseCid,
  verifyCidContent,
} from '@/lib/ipfs/cid-verify';
import {
  GatewayHealthTracker,
  raceGateways,
} from '@/lib/ipfs/gateways';
import {
  MultiProviderPinner,
  PinUnavailableError,
  type IpfsPinner,
} from '@/lib/ipfs/pinner';
import {
  checkAndRepairPin,
  InMemoryPinHealthStore,
  runPinHealthSweep,
} from '@/lib/ipfs/health-monitor';

vi.mock('@/lib/auth/auth', () => ({
  getServerSession: vi.fn(),
}));

import { getServerSession } from '@/lib/auth/auth';
import { POST as cronIpfsHealth } from '@/app/api/admin/cron/ipfs-health/route';
import { GET as getIpfsHealth } from '@/app/api/ipfs/health/route';

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function makeMockProvider(
  name: string,
  options: {
    shouldFailPin?: boolean;
    pinnedCids?: Set<string>;
    shouldFailCheck?: boolean;
    shouldFailRepin?: boolean;
  } = {},
): IpfsPinner & { pinCalls: number; repinCalls: number } {
  const pinnedCids = options.pinnedCids ?? new Set<string>();
  const provider = {
    name,
    pinCalls: 0,
    repinCalls: 0,
    async pin(file: Blob) {
      provider.pinCalls += 1;
      if (options.shouldFailPin) {
        throw new PinUnavailableError(`${name} unavailable`);
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const cid = await computeRawCidV1(bytes);
      pinnedCids.add(cid);
      return { cid, size: bytes.byteLength, providerPinId: `${name}-pin-1` };
    },
    async hasPin(cid: string) {
      if (options.shouldFailCheck) {
        throw new Error(`${name} health API unreachable`);
      }
      return pinnedCids.has(cid);
    },
    async pinByCid(cid: string) {
      provider.repinCalls += 1;
      if (options.shouldFailRepin) {
        throw new PinUnavailableError(`${name} re-pin failed`);
      }
      pinnedCids.add(cid);
      return { cid, size: 0 };
    },
  };
  return provider;
}

describe('IPFS CID Verification (#1769)', () => {
  it('computes and verifies a genuine CIDv1 raw (bafkrei...) against content bytes', async () => {
    const payload = new TextEncoder().encode('portfolio-asset-bytes-v1');
    const cid = await computeRawCidV1(payload);

    expect(cid.startsWith('bafkrei')).toBe(true);
    expect(isValidCid(cid)).toBe(true);

    const parsed = parseCid(cid);
    expect(parsed?.version).toBe(1);
    expect(parsed?.codec).toBe(0x55);
    expect(parsed?.hashCode).toBe(0x12);

    const ok = await verifyCidContent(cid, payload);
    expect(ok.valid).toBe(true);
    expect(ok.method).toBe('cidv1-raw');
  });

  it('rejects tampered content when CID digest does not match', async () => {
    const original = new TextEncoder().encode('authentic-creator-image');
    const tampered = new TextEncoder().encode('malicious-tampered-payload');
    const cid = await computeRawCidV1(original);

    const check = await verifyCidContent(cid, tampered);
    expect(check.valid).toBe(false);
    expect(check.method).toBe('mismatch');
  });

  it('rejects malformed and path-traversal CIDs (negative security test)', async () => {
    expect(isValidCid('../etc/passwd')).toBe(false);
    expect(isValidCid('bafkreiabc/../../secret')).toBe(false);
    expect(isValidCid('bafkreiabc?redirect=evil')).toBe(false);
    expect(isValidCid('')).toBe(false);

    const check = await verifyCidContent('../evil', new TextEncoder().encode('data'));
    expect(check.valid).toBe(false);
    expect(check.method).toBe('invalid-cid');
  });

  it('verifies deterministic dev fallback CIDs', async () => {
    const content = 'dev-fallback-content';
    const digest = await sha256(content);
    const devCid = `bafy${digest.slice(0, 52)}`;
    expect(isValidCid(devCid)).toBe(true);

    const valid = await verifyCidContent(devCid, new TextEncoder().encode(content));
    expect(valid.valid).toBe(true);
    expect(valid.method).toBe('deterministic-dev');

    const invalid = await verifyCidContent(devCid, new TextEncoder().encode('other'));
    expect(invalid.valid).toBe(false);
  });
});

describe('Multi-Provider IPFS Pinning (#1769)', () => {
  it('pins concurrently to >= 2 providers and achieves full redundancy', async () => {
    const pinata = makeMockProvider('pinata');
    const filebase = makeMockProvider('filebase');
    const multi = new MultiProviderPinner([pinata, filebase], { targetRedundancy: 2 });

    const blob = new Blob(['redundant portfolio file'], { type: 'text/plain' });
    const result = await multi.pin(blob, 'asset.txt');

    expect(result.succeededProviders).toEqual(['pinata', 'filebase']);
    expect(result.failedProviders).toEqual([]);
    expect(result.redundancyMet).toBe(true);
    expect(result.degraded).toBe(false);
    expect(pinata.pinCalls).toBe(1);
    expect(filebase.pinCalls).toBe(1);
  });

  it('survives a single provider failure in degraded mode while still pinning to healthy peer', async () => {
    const brokenPinata = makeMockProvider('pinata', { shouldFailPin: true });
    const healthyFilebase = makeMockProvider('filebase');
    const multi = new MultiProviderPinner([brokenPinata, healthyFilebase], {
      targetRedundancy: 2,
      requireQuorum: false,
    });

    const blob = new Blob(['resilient asset'], { type: 'text/plain' });
    const result = await multi.pin(blob, 'resilient.txt');

    expect(result.succeededProviders).toEqual(['filebase']);
    expect(result.failedProviders).toEqual(['pinata']);
    expect(result.redundancyMet).toBe(false);
    expect(result.degraded).toBe(true);
    expect(result.cid).toMatch(/^bafkrei/);
  });

  it('throws PinUnavailableError when requireQuorum is true and quorum is not met', async () => {
    const brokenPinata = makeMockProvider('pinata', { shouldFailPin: true });
    const healthyFilebase = makeMockProvider('filebase');
    const multi = new MultiProviderPinner([brokenPinata, healthyFilebase], {
      targetRedundancy: 2,
      requireQuorum: true,
    });

    await expect(multi.pin(new Blob(['strict']), 'strict.txt')).rejects.toThrow(
      PinUnavailableError,
    );
  });

  it('throws PinUnavailableError when all providers fail', async () => {
    const p1 = makeMockProvider('pinata', { shouldFailPin: true });
    const p2 = makeMockProvider('kubo', { shouldFailPin: true });
    const multi = new MultiProviderPinner([p1, p2]);

    await expect(multi.pin(new Blob(['fail']), 'fail.txt')).rejects.toThrow(PinUnavailableError);
  });
});

describe('Gateway Racing with Timeouts & CID Verification (#1769)', () => {
  let realFetch: typeof globalThis.fetch;

  beforeEach(() => {
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('races gateways concurrently, selects fastest verified response, and aborts slow peers', async () => {
    const content = 'verified-race-payload';
    const bytes = new TextEncoder().encode(content);
    const cid = await computeRawCidV1(bytes);
    const expectedSha = await sha256(content);
    const abortedUrls: string[] = [];

    globalThis.fetch = vi.fn().mockImplementation((input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('slow.gw')) {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            abortedUrls.push(url);
            reject(new Error('Aborted'));
          });
        });
      }
      return Promise.resolve({
        ok: true,
        blob: async () => new Blob([bytes]),
      } as unknown as Response);
    });

    const tracker = new GatewayHealthTracker();
    const res = await raceGateways(cid, {
      gateways: ['https://slow.gw/ipfs/', 'https://fast.gw/ipfs/'],
      verifyHash: expectedSha,
      verifyCid: true,
      timeoutMs: 2000,
      healthTracker: tracker,
    });

    expect(res.gateway).toBe(`https://fast.gw/ipfs/${cid}`);
    expect(res.verified).toBe(true);
    expect(res.cidVerified).toBe(true);
    expect(abortedUrls.some((u) => u.includes('slow.gw'))).toBe(true);
  });

  it('rejects a poisoned gateway returning tampered bytes and falls back to honest peer', async () => {
    const honestContent = 'honest-portfolio-data';
    const honestBytes = new TextEncoder().encode(honestContent);
    const cid = await computeRawCidV1(honestBytes);
    const expectedSha = await sha256(honestContent);

    globalThis.fetch = vi.fn().mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('poisoned.gw')) {
        return {
          ok: true,
          blob: async () => new Blob(['corrupted-tampered-data']),
        } as unknown as Response;
      }
      return {
        ok: true,
        blob: async () => new Blob([honestBytes]),
      } as unknown as Response;
    });

    const tracker = new GatewayHealthTracker();
    const res = await raceGateways(cid, {
      gateways: ['https://poisoned.gw/ipfs/', 'https://honest.gw/ipfs/'],
      verifyHash: expectedSha,
      verifyCid: true,
      timeoutMs: 2000,
      healthTracker: tracker,
    });

    expect(res.gateway).toBe(`https://honest.gw/ipfs/${cid}`);
    expect(res.cidVerified).toBe(true);

    // Poisoned gateway should have a failure recorded
    const snap = tracker.getSnapshot(['https://poisoned.gw/ipfs/', 'https://honest.gw/ipfs/']);
    expect(snap[0].failures).toBeGreaterThanOrEqual(1);
    expect(snap[1].successes).toBe(1);
  });

  it('enforces per-gateway timeout when gateways hang', async () => {
    const bytes = new TextEncoder().encode('timeout-check');
    const cid = await computeRawCidV1(bytes);

    globalThis.fetch = vi.fn().mockImplementation((_input: string | URL, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('Timeout aborted')));
      });
    });

    await expect(
      raceGateways(cid, {
        gateways: ['https://hung.gw/ipfs/'],
        timeoutMs: 50,
        verifyCid: true,
        healthTracker: new GatewayHealthTracker(),
      }),
    ).rejects.toThrow(/All IPFS gateways failed/);
  });
});

describe('Pin Health Monitoring & Automatic Re-pinning (#1769)', () => {
  let realFetch: typeof globalThis.fetch;

  beforeEach(() => {
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('detects when a provider drops a pin, retrieves verified bytes, and auto re-pins', async () => {
    const content = 'creator-hero-banner-v2';
    const bytes = new TextEncoder().encode(content);
    const cid = await computeRawCidV1(bytes);
    const digest = await sha256(content);

    // Provider A still holds the pin; Provider B dropped it!
    const providerA = makeMockProvider('pinata', { pinnedCids: new Set([cid]) });
    const providerB = makeMockProvider('filebase', { pinnedCids: new Set() });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob([bytes]),
    } as unknown as Response);

    const store = new InMemoryPinHealthStore([{ cid, sha256: digest, size: bytes.byteLength }]);
    const report = await checkAndRepairPin(
      { cid, sha256: digest, size: bytes.byteLength },
      [providerA, providerB],
      {
        targetRedundancy: 2,
        gateways: ['https://gw1.example/ipfs/'],
        store,
        healthTracker: new GatewayHealthTracker(),
      },
    );

    expect(report.retrievable).toBe(true);
    expect(report.status).toBe('repaired');
    expect(report.repinnedProviders).toEqual(['filebase']);
    expect(report.healthyProviders).toEqual(expect.arrayContaining(['pinata', 'filebase']));
    expect(providerB.pinCalls).toBe(1);
    expect(await providerB.hasPin!(cid)).toBe(true);

    const replicas = await store.listReplicas(cid);
    expect(replicas).toHaveLength(2);
    expect(replicas.every((r) => r.status === 'PINNED')).toBe(true);
  });

  it('marks pin as unreachable when all providers and gateways fail', async () => {
    const bytes = new TextEncoder().encode('lost-content');
    const cid = await computeRawCidV1(bytes);
    const digest = await sha256('lost-content');

    const providerA = makeMockProvider('pinata', { pinnedCids: new Set() });
    const providerB = makeMockProvider('kubo', { pinnedCids: new Set() });

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('504 Gateway Timeout'));

    const store = new InMemoryPinHealthStore([{ cid, sha256: digest, size: bytes.byteLength }]);
    const summary = await runPinHealthSweep({
      providers: [providerA, providerB],
      store,
      gateways: ['https://down.gw/ipfs/'],
      healthTracker: new GatewayHealthTracker(),
    });

    expect(summary.totalChecked).toBe(1);
    expect(summary.unreachable).toBe(1);
    expect(summary.repinnedCount).toBe(0);
  });
});

describe('IPFS Health API & Cron Boundary Security (#1769)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CRON_SECRET;
  });

  it('rejects unauthenticated requests to GET /api/ipfs/health', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);
    const req = new NextRequest('http://localhost:3000/api/ipfs/health');
    const res = await getIpfsHealth(req);
    expect(res.status).toBe(401);
  });

  it('rejects invalid CID query parameters on GET /api/ipfs/health', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as never);
    const req = new NextRequest('http://localhost:3000/api/ipfs/health?cid=../bad');
    const res = await getIpfsHealth(req);
    expect(res.status).toBe(400);
  });

  it('rejects missing or invalid X-Cron-Secret on POST /api/admin/cron/ipfs-health', async () => {
    process.env.CRON_SECRET = 'cron-secret-123';
    const req = new NextRequest('http://localhost:3000/api/admin/cron/ipfs-health', {
      method: 'POST',
      headers: { 'x-cron-secret': 'wrong-secret' },
    });
    const res = await cronIpfsHealth(req);
    expect(res.status).toBe(401);
  });
});
