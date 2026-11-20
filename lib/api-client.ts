/**
 * Typed API client for the Stellar backend.
 *
 * Every request goes through `apiFetch`, which:
 *  - Attaches `Content-Type: application/json`
 *  - Parses the `ApiResponse<T>` envelope
 *  - Throws `ApiClientError` on network or API-level failures
 *
 * Usage:
 *   const creator = await apiFetch<Creator>('/api/creators/alex-studio');
 */

import {
  type ApiResponse,
  type ApiError,
  type ApiErrorCode,
  type Bounty,
  type Creator,
  type CreatorReputationPayload,
  type FilteredCreatorReputationPayload,
  type PaginatedReviews,
  type ReputationAggregation,
  type ReviewFilterOptions,
  type PaginatedData,
  type ReviewSubmission,
  type EscrowTransactionRequest,
  type EscrowTransactionResponse,
  isApiSuccess,
} from './api-models';
import { notifyLoadingChange } from '@/components/layout/layout-provider';

// ── Error class ───────────────────────────────────────────────────────────────

export class ApiClientError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly fieldErrors?: { field: string; message: string }[],
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }

  static fromApiError(error: ApiError, status?: number): ApiClientError {
    return new ApiClientError(
      error.code,
      error.message,
      error.fieldErrors,
      status,
    );
  }

  static network(
    message = 'Network error — please check your connection',
  ): ApiClientError {
    return new ApiClientError('SERVICE_UNAVAILABLE', message);
  }
}

// ── Base fetch ────────────────────────────────────────────────────────────────

const BASE_URL =
  typeof process !== 'undefined' ? (process.env.NEXT_PUBLIC_API_URL ?? '') : '';

export const API_VERSION = 'v1';
export const API_BASE = `/api/${API_VERSION}`;

/**
 * Legacy localStorage key that used to hold the JWT. Auth now lives in an
 * httpOnly cookie set by the server, so this key is only referenced to purge
 * any stale token left behind by older clients.
 */
const LEGACY_JWT_STORAGE_KEY = 'stellar_auth_token';

/** Name of the non-httpOnly cookie the server uses to expose the CSRF token. */
const CSRF_COOKIE_NAME = 'csrf_token';

/** Header the server expects the CSRF token to be echoed back in. */
const CSRF_HEADER_NAME = 'X-CSRF-Token';

/**
 * Remove any JWT persisted by older versions of the app. The token is now
 * stored in an httpOnly cookie and is never readable from `document`.
 */
export function clearLegacyAuthToken(): void {
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem(LEGACY_JWT_STORAGE_KEY);
    } catch {
      // localStorage may be unavailable (private mode / disabled) — ignore.
    }
  }
}

// Purge the legacy token as soon as this module loads in the browser.
if (typeof window !== 'undefined') {
  clearLegacyAuthToken();
}

/** Read the CSRF token from its (non-httpOnly) cookie, if present. */
function getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${CSRF_COOKIE_NAME}=([^;]*)`),
  );
  return match ? decodeURIComponent(match[1]) : null;
}

/** HTTP methods that mutate state and therefore require CSRF protection. */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Fetch a backend endpoint and unwrap the `ApiResponse<T>` envelope.
 * Throws `ApiClientError` on any failure so callers never receive raw errors.
 *
 * Auth is carried by an httpOnly cookie, so requests are sent with
 * `credentials: 'include'`. Mutating requests additionally echo the CSRF token
 * from the `csrf_token` cookie via the `X-CSRF-Token` header.
 */
export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;

  const method = (init.method ?? 'GET').toUpperCase();
  const csrfToken = MUTATING_METHODS.has(method) ? getCsrfToken() : null;
  const csrfHeader: Record<string, string> = csrfToken
    ? { [CSRF_HEADER_NAME]: csrfToken }
    : {};

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'Accept-Version': API_VERSION,
    ...csrfHeader,
    ...(init.headers ?? {}),
  };

  notifyLoadingChange(1);
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers, credentials: 'include' });
  } catch {
    notifyLoadingChange(-1);
    throw ApiClientError.network();
  }

  let envelope: ApiResponse<T>;
  try {
    envelope = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new ApiClientError(
      'INTERNAL_SERVER_ERROR',
      `Unexpected response format from ${path}`,
      undefined,
      res.status,
    );
  } finally {
    notifyLoadingChange(-1);
  }

  if (isApiSuccess(envelope)) return envelope.data;

  throw ApiClientError.fromApiError(envelope.error, res.status);
}

// ── Request deduplication (prevents duplicate in-flight requests) ────────────────
const requestCache = new Map<string, Promise<any>>();

function getCacheKey(path: string, init?: RequestInit): string {
  const method = init?.method || 'GET';
  const body = init?.body ? JSON.stringify(init.body) : '';
  return `${method}:${path}:${body}`;
}

async function dedupedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const key = getCacheKey(path, init);

  if (requestCache.has(key)) {
    return requestCache.get(key)!;
  }

  const promise = apiFetch<T>(path, init);
  requestCache.set(key, promise);

  try {
    return await promise;
  } finally {
    // Clear from cache after request completes
    requestCache.delete(key);
  }
}

// ── Domain helpers ────────────────────────────────────────────────────────────

/** GET /api/v1/creators — optionally filter by discipline or search term. */
export async function fetchCreators(params?: {
  discipline?: string;
  search?: string;
}): Promise<{ creators: Creator[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.discipline) qs.set('discipline', params.discipline);
  if (params?.search) qs.set('search', params.search);
  const query = qs.toString() ? `?${qs}` : '';
  return dedupedFetch(`${API_BASE}/creators${query}`);
}

/** GET /api/v1/creators/:id */
export async function fetchCreator(id: string): Promise<Creator> {
  return dedupedFetch(`${API_BASE}/creators/${id}`);
}

/** GET /api/v1/creators/:id/reputation */
export async function fetchCreatorReputation(
  id: string,
): Promise<CreatorReputationPayload> {
  return dedupedFetch(`${API_BASE}/creators/${id}/reputation`);
}

/** POST /api/creators/reviews/batch — batch fetch reviews for multiple creators */
export async function fetchCreatorReviewsBatch(
  creatorIds: string[],
): Promise<Record<string, { reviews: any[]; total: number }>> {
  return apiFetch('/api/creators/reviews/batch', {
    method: 'POST',
    body: JSON.stringify({ creatorIds }),
  });
}

/** POST /api/creators/reputation/batch — batch fetch reputation for multiple creators */
export async function fetchCreatorReputationBatch(
  creatorIds: string[],
): Promise<Record<string, any>> {
  return apiFetch('/api/creators/reputation/batch', {
    method: 'POST',
    body: JSON.stringify({ creatorIds }),
  });
}

/** GET /api/v1/creators/:id/reviews - Enhanced with filtering support */
export async function fetchCreatorReviews(
  id: string,
  filters?: ReviewFilterOptions,
): Promise<FilteredCreatorReputationPayload> {
  const params = new URLSearchParams();
  if (filters) {
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.set(key, value.toString());
      }
    });
  }
  const query = params.toString() ? `?${params}` : '';
  return apiFetch(`${API_BASE}/creators/${id}/reviews${query}`);
}

/** GET /api/v1/reviews - List all reviews with filtering */
export async function fetchAllReviews(filters?: ReviewFilterOptions): Promise<{
  reviews: PaginatedReviews;
  overallAggregation: ReputationAggregation;
  filteredAggregation?: ReputationAggregation;
  appliedFilters: ReviewFilterOptions;
}> {
  const params = new URLSearchParams();
  if (filters) {
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.set(key, value.toString());
      }
    });
  }
  const query = params.toString() ? `?${params}` : '';
  return apiFetch(`${API_BASE}/reviews${query}`);
}

/** GET /api/v1/bounties — optionally paginated. */
export async function fetchBounties(params?: {
  page?: number;
  limit?: number;
  category?: string;
  difficulty?: string;
  status?: string;
}): Promise<PaginatedData<Bounty>> {
  const qs = new URLSearchParams();
  if (params?.page) qs.set('page', String(params.page));
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.category) qs.set('category', params.category);
  if (params?.difficulty) qs.set('difficulty', params.difficulty);
  if (params?.status) qs.set('status', params.status);
  const query = qs.toString() ? `?${qs}` : '';
  return dedupedFetch(`${API_BASE}/bounties${query}`);
}

export async function submitReview(
  data: ReviewSubmission,
): Promise<{ reviewId: string }> {
  return apiFetch(`${API_BASE}/reviews`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function submitEscrowTransaction(
  data: EscrowTransactionRequest,
): Promise<EscrowTransactionResponse> {
  return apiFetch(`${API_BASE}/escrow/transaction`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function releaseEscrow(
  escrowId: string,
  authorizerAddress: string,
): Promise<EscrowTransactionResponse> {
  return apiFetch(`${API_BASE}/escrow/${escrowId}/release`, {
    method: 'POST',
    body: JSON.stringify({ authorizerAddress }),
  });
}
