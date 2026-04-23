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
  type Creator,
  type CreatorReputationPayload,
  type PaginatedData,
  type ReviewSubmission,
  type EscrowTransactionRequest,
  type EscrowTransactionResponse,
  isApiSuccess,
} from './api-models';
import { notifyLoadingChange } from '../components/layout-provider';

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
    return new ApiClientError(error.code, error.message, error.fieldErrors, status);
  }

  static network(message = 'Network error — please check your connection'): ApiClientError {
    return new ApiClientError('SERVICE_UNAVAILABLE', message);
  }
}

// ── Base fetch ────────────────────────────────────────────────────────────────

const BASE_URL =
  typeof process !== 'undefined'
    ? (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001')
    : 'http://localhost:3001';

/**
 * Fetch a backend endpoint and unwrap the `ApiResponse<T>` envelope.
 * Throws `ApiClientError` on any failure so callers never receive raw errors.
 */
export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(init.headers ?? {}),
  };

  notifyLoadingChange(1);
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers });
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

// ── Domain helpers ────────────────────────────────────────────────────────────

/** GET /api/creators — optionally filter by discipline or search term. */
export async function fetchCreators(params?: {
  discipline?: string;
  search?: string;
}): Promise<{ creators: Creator[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.discipline) qs.set('discipline', params.discipline);
  if (params?.search) qs.set('search', params.search);
  const query = qs.toString() ? `?${qs}` : '';
  return apiFetch(`/api/creators${query}`);
}

/** GET /api/creators/:id */
export async function fetchCreator(id: string): Promise<Creator> {
  return apiFetch(`/api/creators/${id}`);
}

/** GET /api/creators/:id/reputation */
export async function fetchCreatorReputation(
  id: string,
): Promise<CreatorReputationPayload> {
  return apiFetch(`/api/creators/${id}/reputation`);
}

/** GET /api/bounties — optionally paginated. */
export async function fetchBounties(params?: {
  page?: number;
  limit?: number;
  category?: string;
  difficulty?: string;
}): Promise<PaginatedData<unknown>> {
  const qs = new URLSearchParams();
  if (params?.page) qs.set('page', String(params.page));
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.category) qs.set('category', params.category);
  if (params?.difficulty) qs.set('difficulty', params.difficulty);
  const query = qs.toString() ? `?${qs}` : '';
  return apiFetch(`/api/bounties${query}`);
}

/** GET /api/freelancers — optionally filter by discipline. */
export async function fetchFreelancers(params?: {
  discipline?: string;
}): Promise<{ freelancers: unknown[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.discipline) qs.set('discipline', params.discipline);
  const query = qs.toString() ? `?${qs}` : '';
  return apiFetch(`/api/freelancers${query}`);
}

/** GET /api/freelancers/:address */
export async function fetchFreelancer(address: string): Promise<unknown> {
  return apiFetch(`/api/freelancers/${address}`);
}

/** POST /api/reviews — submit a review after bounty completion. */
export async function submitReview(
  data: ReviewSubmission,
): Promise<{ reviewId: string }> {
  return apiFetch('/api/reviews', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/** POST /api/escrow/transaction — submit a Stellar escrow transaction via the backend SDK. */
export async function submitEscrowTransaction(
  data: EscrowTransactionRequest,
): Promise<EscrowTransactionResponse> {
  return apiFetch('/api/escrow/transaction', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/** POST /api/escrow/:id/release — release escrowed funds to payee. */
export async function releaseEscrow(
  escrowId: string,
  authorizerAddress: string,
): Promise<EscrowTransactionResponse> {
  return apiFetch(`/api/escrow/${escrowId}/release`, {
    method: 'POST',
    body: JSON.stringify({ authorizerAddress }),
  });
}
