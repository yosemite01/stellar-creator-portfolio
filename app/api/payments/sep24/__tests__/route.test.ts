import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, GET } from '../route';
import { createSep24Transaction } from '@/lib/stellar/sep24-service';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/stellar/sep24-service', () => ({
  createSep24Transaction: vi.fn(),
}));

import { getServerSession } from 'next-auth';

describe('POST /api/payments/sep24', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('401s when there is no authenticated session', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const req = new NextRequest('http://localhost:3000/api/payments/sep24', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('400s when body is invalid JSON', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'user-1' },
    });
    const req = new NextRequest('http://localhost:3000/api/payments/sep24', {
      method: 'POST',
      body: 'invalid-json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('400s when schema validation fails', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'user-1' },
    });
    const req = new NextRequest('http://localhost:3000/api/payments/sep24', {
      method: 'POST',
      body: JSON.stringify({ invalid: true }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Validation failed');
  });

  it('503s when no anchor domain is configured', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'user-1' },
    });
    delete process.env.SEP24_ANCHOR_DOMAIN;

    const req = new NextRequest('http://localhost:3000/api/payments/sep24', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'deposit',
        assetCode: 'USDC',
        amount: '100',
        destinationAddress: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toContain('No SEP-24 anchor is configured');
  });

  it('persists transaction to database on success', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'user-1' },
    });
    process.env.SEP24_ANCHOR_DOMAIN = 'testanchor.stellar.org';
    process.env.SEP24_AUTH_TOKEN = 'mock-jwt';

    const mockTransferServer = 'https://testanchor.stellar.org/sep24';
    
    vi.mock('@/lib/stellar/sep24', () => ({
      discoverTransferServer: vi.fn().mockResolvedValue(mockTransferServer),
      startInteractiveFlow: vi.fn().mockResolvedValue({
        id: 'anchor-tx-123',
        url: 'https://anchor.example.com/interactive?tx=123',
        type: 'interactive_customer_info_needed',
      }),
      Sep24Error: class Sep24Error extends Error {
        constructor(message: string, status?: number) {
          super(message);
          this.name = 'Sep24Error';
        }
      },
    }));

    (createSep24Transaction as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'db-tx-456',
      userId: 'user-1',
      anchorId: 'anchor-tx-123',
      status: 'pending_user_transfer_start',
    });

    const req = new NextRequest('http://localhost:3000/api/payments/sep24', {
      method: 'POST',
      body: JSON.stringify({
        recipientAddress: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        amount: 100,
        description: 'Test deposit',
        memo: 'test',
      }),
    });
    
    const res = await POST(req);
    expect(res.status).toBe(200);
    
    const data = await res.json();
    expect(data).toEqual({
      id: 'anchor-tx-123',
      url: 'https://anchor.example.com/interactive?tx=123',
    });
    
    expect(createSep24Transaction).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        anchorId: 'anchor-tx-123',
        transferServer: mockTransferServer,
        kind: 'deposit',
        assetCode: 'USDC',
      }),
    );
  });
});

describe('GET /api/payments/sep24', () => {
  it('401s when not authenticated', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const req = new NextRequest('http://localhost:3000/api/payments/sep24', {
      method: 'GET',
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('lists user transactions', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'user-1' },
    });

    const mockPrisma = {
      sep24Transaction: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'tx-1',
            userId: 'user-1',
            anchorId: 'anchor-tx-1',
            status: 'completed',
            statusHistory: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
        $disconnect: vi.fn(),
      },
    };

    vi.resetAllMocks();
    
    vi.doMock('@/lib/prisma', () => ({
      prisma: mockPrisma,
    }));

    const req = new NextRequest('http://localhost:3000/api/payments/sep24', {
      method: 'GET',
    });
    
    const res = await GET(req);
    expect(res.status).toBe(200);
    
    const data = await res.json();
    expect(data.transactions).toHaveLength(1);
    expect(data.meta).toEqual({
      limit: 20,
      offset: 0,
      count: 1,
    });
  });
});