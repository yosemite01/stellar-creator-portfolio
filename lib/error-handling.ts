/**
 * Error handling utilities for API responses.
 * 
 * Provides consistent error formatting and user-friendly messages
 * for API error responses across the frontend.
 */

import type { ApiError, ApiResponse } from '@/lib/api-models';

/**
 * User-friendly error messages for different error codes.
 */
export const ERROR_MESSAGES: Record<string, string> = {
  BAD_REQUEST: 'Invalid request. Please check your input.',
  VALIDATION_ERROR: 'Please correct the errors below.',
  UNAUTHORIZED: 'You are not authorized to perform this action.',
  FORBIDDEN: 'You do not have permission to access this resource.',
  NOT_FOUND: 'The requested resource was not found.',
  CONFLICT: 'This resource already exists.',
  UNPROCESSABLE_ENTITY: 'Unable to process your request.',
  INTERNAL_SERVER_ERROR: 'An error occurred on the server. Please try again.',
  SERVICE_UNAVAILABLE: 'The service is temporarily unavailable. Please try again later.',
};

/**
 * Get a user-friendly error message from an API error.
 */
export function getErrorMessage(error: ApiError): string {
  return ERROR_MESSAGES[error.code] || error.message;
}

/**
 * Extract field errors from a validation error.
 */
export function getFieldErrors(
  error: ApiError,
): Record<string, string> {
  if (!error.fieldErrors || !Array.isArray(error.fieldErrors)) {
    return {};
  }

  const fieldErrorMap: Record<string, string> = {};
  for (const fieldError of error.fieldErrors) {
    fieldErrorMap[fieldError.field] = fieldError.message;
  }
  return fieldErrorMap;
}

/**
 * Format an API response error into a callable exception structure.
 */
export interface FormattedError {
  code: string;
  message: string;
  userMessage: string;
  fieldErrors: Record<string, string>;
}

/**
 * Format an API error response for consistent error handling.
 */
export function formatApiError(
  error: ApiError | string,
): FormattedError {
  if (typeof error === 'string') {
    return {
      code: 'UNKNOWN_ERROR',
      message: error,
      userMessage: 'An unexpected error occurred.',
      fieldErrors: {},
    };
  }

  return {
    code: error.code,
    message: error.message,
    userMessage: getErrorMessage(error),
    fieldErrors: getFieldErrors(error),
  };
}

/**
 * Handle an API response and throw if it failed.
 */
export function handleApiResponse<T>(
  response: ApiResponse<T>,
): T {
  if (!response.success && response.error) {
    const formatted = formatApiError(response.error);
    const error = new Error(formatted.userMessage);
    (error as any).code = formatted.code;
    (error as any).fieldErrors = formatted.fieldErrors;
    throw error;
  }

  if (!response.data) {
    throw new Error('No data in API response');
  }

  return response.data;
}
