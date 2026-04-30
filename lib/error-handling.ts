/**
 * Error handling utilities for API responses.
 * 
 * Provides consistent error formatting and user-friendly messages
 * for API error responses across the frontend.
 * Integrates with centralized error tracking for production observability.
 */

import type { ApiError, ApiResponse } from '@/lib/api-models';
import { errorTracker, type ErrorContext } from '@/lib/error-tracking';

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
 * Escrow-specific error messages keyed by the error message substring
 * returned from the Soroban contract.
 */
export const ESCROW_ERROR_MESSAGES: Record<string, string> = {
  'Escrow not found': 'The escrow account could not be found.',
  'Escrow not active': 'This escrow is no longer active.',
  'Release condition not met': 'The release condition has not been met yet.',
  'Unauthorized': 'You are not authorized to perform this escrow action.',
  'Only payer can refund': 'Only the payer can request a refund.',
  'Only payer can add milestones': 'Only the payer can add milestones.',
  'Only payer can release milestones': 'Only the payer can release milestones.',
  'Milestone already released': 'This milestone has already been released.',
  'Milestone not found': 'The specified milestone could not be found.',
  'Milestone amount exceeds escrow': 'The milestone amount exceeds the escrow balance.',
  'Amount must be positive': 'The escrow amount must be greater than zero.',
  'Unknown operation': 'The requested escrow operation is not supported.',
};

/**
 * Get a user-friendly error message from an API error,
 * with special handling for escrow contract errors.
 */
export function getErrorMessage(error: ApiError): string {
  // Check for escrow-specific messages first
  for (const [key, msg] of Object.entries(ESCROW_ERROR_MESSAGES)) {
    if (error.message.includes(key)) return msg;
  }
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
 * Automatically tracks errors to centralized monitoring.
 */
export function handleApiResponse<T>(
  response: ApiResponse<T>,
  context?: ErrorContext,
): T {
  if (!response.success && response.error) {
    const formatted = formatApiError(response.error);
    const error = new Error(formatted.userMessage);
    (error as any).code = formatted.code;
    (error as any).fieldErrors = formatted.fieldErrors;

    // Track error to centralized system
    void errorTracker.captureError(error, {
      ...context,
      metadata: {
        code: formatted.code,
        fieldErrors: formatted.fieldErrors,
      },
    });

    throw error;
  }

  if (!response.data) {
    const error = new Error('No data in API response');
    void errorTracker.captureError(error, context);
    throw error;
  }

  return response.data;
}
