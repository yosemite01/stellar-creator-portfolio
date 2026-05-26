// Mock API service for frontend tests (#334)
import { vi } from 'vitest';
import {
  apiSuccess,
  apiFailure,
  type ApiErrorCode,
  type ApiResponse,
} from './api-models';

type MockHandler = (url: string, init?: RequestInit) => Promise<Response>;

function makeResponse(body: unknown, status = 200): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/**
 * Install a global fetch mock that routes requests to registered handlers.
 * Call in beforeEach; vi.unstubAllGlobals() in afterEach restores the original.
 */
export function setupMockApi(handlers: Record<string, MockHandler>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      for (const [pattern, handler] of Object.entries(handlers)) {
        if (url.includes(pattern)) return handler(url, init);
      }
      return makeResponse(apiFailure('NOT_FOUND', `No mock for ${url}`), 404);
    }),
  );
}

/** Respond with a success envelope. */
export function mockSuccess<T>(data: T, status = 200): MockHandler {
  return () => Promise.resolve(makeResponse(apiSuccess(data), status));
}

/** Respond with a failure envelope. */
export function mockError(
  code: ApiErrorCode,
  message: string,
  status = 400,
): MockHandler {
  return () => Promise.resolve(makeResponse(apiFailure(code, message), status));
}

/** Simulate a network-level failure (fetch rejects). */
export function mockNetworkError(message = 'Network error'): MockHandler {
  return () => Promise.reject(new Error(message));
}

/** Simulate a pending request that never resolves. */
export function mockPending(): MockHandler {
  return () => new Promise(() => {});
}

/** Build a raw ApiResponse success envelope (re-export for convenience). */
export function successEnvelope<T>(data: T): ApiResponse<T> {
  return apiSuccess(data);
}

/** Build a raw ApiResponse failure envelope (re-export for convenience). */
export function failureEnvelope(
  code: ApiErrorCode,
  message: string,
): ApiResponse<never> {
  return apiFailure(code, message);
}
