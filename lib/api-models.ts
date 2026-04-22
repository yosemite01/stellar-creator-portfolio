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
