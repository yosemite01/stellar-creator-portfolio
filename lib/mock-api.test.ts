import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  setupMockApi,
  mockSuccess,
  mockError,
  mockNetworkError,
  mockPending,
  successEnvelope,
  failureEnvelope,
} from './mock-api';
import { apiFetch, ApiClientError } from './api-client';

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('setupMockApi', () => {
  it('routes matched requests to the correct handler', async () => {
    setupMockApi({
      '/api/creators': mockSuccess({ creators: [], total: 0 }),
    });
    const result = await apiFetch<{ creators: unknown[]; total: number }>('/api/creators');
    expect(result.total).toBe(0);
  });

  it('returns 404 for unregistered routes', async () => {
    setupMockApi({});
    await expect(apiFetch('/api/unknown')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('routes multiple handlers independently', async () => {
    setupMockApi({
      '/api/creators': mockSuccess({ creators: [], total: 0 }),
      '/api/bounties': mockSuccess({ items: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 0 } }),
    });
    const creators = await apiFetch<{ total: number }>('/api/creators');
    const bounties = await apiFetch<{ items: unknown[] }>('/api/bounties');
    expect(creators.total).toBe(0);
    expect(bounties.items).toHaveLength(0);
  });
});

describe('mockSuccess', () => {
  it('wraps data in a success envelope', async () => {
    setupMockApi({ '/api/test': mockSuccess({ id: '1' }) });
    const result = await apiFetch<{ id: string }>('/api/test');
    expect(result.id).toBe('1');
  });

  it('uses custom status code', async () => {
    setupMockApi({ '/api/test': mockSuccess({ id: '1' }, 201) });
    const result = await apiFetch<{ id: string }>('/api/test');
    expect(result.id).toBe('1');
  });
});

describe('mockError', () => {
  it('throws ApiClientError with correct code', async () => {
    setupMockApi({ '/api/test': mockError('NOT_FOUND', 'Missing', 404) });
    await expect(apiFetch('/api/test')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  it('throws UNAUTHORIZED on 401', async () => {
    setupMockApi({ '/api/secure': mockError('UNAUTHORIZED', 'No token', 401) });
    await expect(apiFetch('/api/secure')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('throws VALIDATION_ERROR on 422', async () => {
    setupMockApi({ '/api/reviews': mockError('VALIDATION_ERROR', 'Invalid input', 422) });
    await expect(apiFetch('/api/reviews')).rejects.toBeInstanceOf(ApiClientError);
  });
});

describe('mockNetworkError', () => {
  it('causes apiFetch to throw SERVICE_UNAVAILABLE', async () => {
    setupMockApi({ '/api/test': mockNetworkError() });
    await expect(apiFetch('/api/test')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
  });

  it('uses custom error message', async () => {
    setupMockApi({ '/api/test': mockNetworkError('Connection refused') });
    await expect(apiFetch('/api/test')).rejects.toBeInstanceOf(ApiClientError);
  });
});

describe('mockPending', () => {
  it('never resolves', async () => {
    setupMockApi({ '/api/test': mockPending() });
    const result = await Promise.race([
      apiFetch('/api/test').then(() => 'resolved'),
      new Promise<string>((r) => setTimeout(() => r('timeout'), 50)),
    ]);
    expect(result).toBe('timeout');
  });
});

describe('successEnvelope / failureEnvelope', () => {
  it('successEnvelope builds a valid success shape', () => {
    const env = successEnvelope({ id: 'x' });
    expect(env.success).toBe(true);
    if (env.success) expect(env.data).toEqual({ id: 'x' });
  });

  it('failureEnvelope builds a valid failure shape', () => {
    const env = failureEnvelope('FORBIDDEN', 'Access denied');
    expect(env.success).toBe(false);
    if (!env.success) {
      expect(env.error.code).toBe('FORBIDDEN');
      expect(env.error.message).toBe('Access denied');
    }
  });
});
