/**
 * Domain models for API responses.
 *
 * Provides consistent data formatting and error handling for all
 * communication between the frontend and the Stellar backend API.
 * The shape mirrors the Rust `ApiResponse<T>` struct in
 * `backend/services/api/src/main.rs`.
 */

// ── Core envelope ────────────────────────────────────────────────────────────

/** Successful API response envelope. */
export interface ApiSuccess<T> {
  success: true;
  data: T;
  message?: string;
  error: null;
}

/** Failed API response envelope. */
export interface ApiFailure {
  success: false;
  data: null;
  error: ApiError;
  message?: string;
}

/** Discriminated union covering every API response shape. */
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

// ── Error models ─────────────────────────────────────────────────────────────

/** Structured error returned by the API. */
export interface ApiError {
  /** Machine-readable error code (e.g. "NOT_FOUND", "VALIDATION_ERROR"). */
  code: ApiErrorCode;
  /** Human-readable description of the error. */
  message: string;
  /** Per-field validation errors, present when code === "VALIDATION_ERROR". */
  fieldErrors?: FieldError[];
}

/** Per-field validation error detail. */
export interface FieldError {
  field: string;
  message: string;
}

/** Exhaustive set of error codes the API may return. */
export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNPROCESSABLE_ENTITY'
  | 'INTERNAL_SERVER_ERROR'
  | 'SERVICE_UNAVAILABLE';

// ── Pagination ────────────────────────────────────────────────────────────────

/** Pagination metadata included in list responses. */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** Paginated list response data. */
export interface PaginatedData<T> {
  items: T[];
  pagination: PaginationMeta;
}

// ── Helper constructors ───────────────────────────────────────────────────────

/** Build a successful response envelope. */
export function apiSuccess<T>(data: T, message?: string): ApiSuccess<T> {
  return { success: true, data, error: null, ...(message ? { message } : {}) };
}

/** Build a failed response envelope. */
export function apiFailure(
  code: ApiErrorCode,
  message: string,
  fieldErrors?: FieldError[],
): ApiFailure {
  const error: ApiError = { code, message, ...(fieldErrors ? { fieldErrors } : {}) };
  return { success: false, data: null, error };
}

/** Build a paginated data payload. */
export function paginatedData<T>(
  items: T[],
  page: number,
  limit: number,
  total: number,
): PaginatedData<T> {
  return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

// ── Type guards ───────────────────────────────────────────────────────────────

/** Narrow an `ApiResponse<T>` to `ApiSuccess<T>`. */
export function isApiSuccess<T>(res: ApiResponse<T>): res is ApiSuccess<T> {
  return res.success === true;
}

/** Narrow an `ApiResponse<T>` to `ApiFailure`. */
export function isApiFailure<T>(res: ApiResponse<T>): res is ApiFailure {
  return res.success === false;
}

/** Return true when the failure carries per-field validation errors. */
export function isValidationError(error: ApiError): boolean {
  return error.code === 'VALIDATION_ERROR' && Array.isArray(error.fieldErrors);
}

// ── Creator reputation (GET /api/creators/:id/reputation) ───────────────────

/** Single public review on a creator profile. */
export interface PublicReview {
  id: string;
  rating: number;
  title: string;
  body: string;
  reviewerName: string;
  createdAt: string;
}

/** Histogram and average for a creator’s reviews. */
export interface ReputationAggregation {
  averageRating: number;
  totalReviews: number;
  stars5: number;
  stars4: number;
  stars3: number;
  stars2: number;
  stars1: number;
  isVerified: boolean;
}

/** Payload for creator reputation + recent reviews. */
export interface CreatorReputationPayload {
  creatorId: string;
  aggregation: ReputationAggregation;
  recentReviews: PublicReview[];
}

// ── Review submission ─────────────────────────────────────────────────────────────

/** Payload sent when submitting a review after bounty completion. */
export interface ReviewSubmission {
  bountyId: string;
  creatorId: string;
  rating: number;       // 1–5
  title: string;
  body: string;
  reviewerName: string;
}

/** Validated review submission — all fields confirmed non-empty. */
export type ValidatedReview = ReviewSubmission;

/** Validate a ReviewSubmission. Returns field errors or null if valid. */
export function validateReview(data: Partial<ReviewSubmission>): FieldError[] | null {
  const errors: FieldError[] = [];
  if (!data.bountyId?.trim()) errors.push({ field: 'bountyId', message: 'Bounty ID is required' });
  if (!data.creatorId?.trim()) errors.push({ field: 'creatorId', message: 'Creator ID is required' });
  if (!data.rating || data.rating < 1 || data.rating > 5)
    errors.push({ field: 'rating', message: 'Rating must be between 1 and 5' });
  if (!data.title?.trim()) errors.push({ field: 'title', message: 'Title is required' });
  if (!data.body?.trim()) errors.push({ field: 'body', message: 'Feedback is required' });
  if (!data.reviewerName?.trim()) errors.push({ field: 'reviewerName', message: 'Your name is required' });
  return errors.length > 0 ? errors : null;
}

// ── Creator (mirrors Rust Creator struct) ─────────────────────────────────────

export interface Creator {
  id: string;
  name: string;
  title: string;
  discipline: string;
  bio: string;
  avatar: string;
  coverImage: string;
  tagline: string;
  linkedIn: string;
  twitter: string;
  portfolio?: string;
  skills: string[];
  stats?: { projects: number; clients: number; experience: number };
  hourlyRate?: number;
  responseTime?: string;
  availability?: 'available' | 'limited' | 'unavailable';
  rating?: number;
  reviewCount?: number;
}
