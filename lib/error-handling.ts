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
 * A single contract error definition: the numeric code emitted by the
 * Soroban contract, a stable machine-readable name, an i18n key, and the
 * default (English) human-readable message.
 */
export interface ContractErrorDefinition {
  code: number;
  name: string;
  i18nKey: string;
  message: string;
}

/**
 * Escrow contract error map, keyed by numeric contract error code.
 * Derived from `backend/contracts/escrow/src/lib.rs` `#[contracterror]`.
 */
export const ESCROW_CONTRACT_ERRORS: Record<number, ContractErrorDefinition> = {
  1: { code: 1, name: 'Unauthorized', i18nKey: 'contract.escrow.unauthorized', message: 'You are not authorized to perform this escrow action.' },
  2: { code: 2, name: 'EscrowNotFound', i18nKey: 'contract.escrow.notFound', message: 'The escrow account could not be found.' },
  3: { code: 3, name: 'EscrowNotActive', i18nKey: 'contract.escrow.notActive', message: 'This escrow is no longer active.' },
  4: { code: 4, name: 'ReleaseConditionNotMet', i18nKey: 'contract.escrow.releaseConditionNotMet', message: 'The release condition has not been met yet.' },
  5: { code: 5, name: 'MilestoneNotFound', i18nKey: 'contract.escrow.milestoneNotFound', message: 'The specified milestone could not be found.' },
  6: { code: 6, name: 'MilestoneAlreadyReleased', i18nKey: 'contract.escrow.milestoneAlreadyReleased', message: 'This milestone has already been released.' },
  7: { code: 7, name: 'MilestoneAmountExceedsEscrow', i18nKey: 'contract.escrow.milestoneAmountExceedsEscrow', message: 'The milestone amount exceeds the escrow balance.' },
  8: { code: 8, name: 'AmountMustBePositive', i18nKey: 'contract.escrow.amountMustBePositive', message: 'The escrow amount must be greater than zero.' },
  9: { code: 9, name: 'OnlyPayerCanRefund', i18nKey: 'contract.escrow.onlyPayerCanRefund', message: 'Only the payer can request a refund.' },
  10: { code: 10, name: 'OnlyPayerCanAddMilestones', i18nKey: 'contract.escrow.onlyPayerCanAddMilestones', message: 'Only the payer can add milestones.' },
  11: { code: 11, name: 'OnlyPayerCanReleaseMilestones', i18nKey: 'contract.escrow.onlyPayerCanReleaseMilestones', message: 'Only the payer can release milestones.' },
  12: { code: 12, name: 'UnknownOperation', i18nKey: 'contract.escrow.unknownOperation', message: 'The requested escrow operation is not supported.' },
};

/**
 * Bounty contract error map, keyed by numeric contract error code.
 * Derived from `backend/contracts/bounty/src/lib.rs` `#[contracterror]`.
 */
export const BOUNTY_CONTRACT_ERRORS: Record<number, ContractErrorDefinition> = {
  1: { code: 1, name: 'Unauthorized', i18nKey: 'contract.bounty.unauthorized', message: 'You are not authorized to perform this bounty action.' },
  2: { code: 2, name: 'BountyNotFound', i18nKey: 'contract.bounty.notFound', message: 'The bounty could not be found.' },
  3: { code: 3, name: 'BountyNotActive', i18nKey: 'contract.bounty.notActive', message: 'This bounty is no longer active.' },
  4: { code: 4, name: 'BountyAlreadyClaimed', i18nKey: 'contract.bounty.alreadyClaimed', message: 'This bounty has already been claimed.' },
  5: { code: 5, name: 'SubmissionNotFound', i18nKey: 'contract.bounty.submissionNotFound', message: 'The specified submission could not be found.' },
  6: { code: 6, name: 'SubmissionAlreadyReviewed', i18nKey: 'contract.bounty.submissionAlreadyReviewed', message: 'This submission has already been reviewed.' },
  7: { code: 7, name: 'RewardMustBePositive', i18nKey: 'contract.bounty.rewardMustBePositive', message: 'The bounty reward must be greater than zero.' },
  8: { code: 8, name: 'DeadlineInPast', i18nKey: 'contract.bounty.deadlineInPast', message: 'The bounty deadline must be in the future.' },
  9: { code: 9, name: 'InvalidStatus', i18nKey: 'contract.bounty.invalidStatus', message: 'The bounty is not in a valid state for this action.' },
  10: { code: 10, name: 'InsufficientFunds', i18nKey: 'contract.bounty.insufficientFunds', message: 'There are insufficient funds to complete this bounty action.' },
};

/**
 * All known contract error maps, keyed by contract name.
 */
export const CONTRACT_ERROR_MAPS: Record<string, Record<number, ContractErrorDefinition>> = {
  escrow: ESCROW_CONTRACT_ERRORS,
  bounty: BOUNTY_CONTRACT_ERRORS,
};

/**
 * A typed, human-readable contract error.
 */
export interface ContractError {
  contract: string;
  code: number;
  name: string;
  i18nKey: string;
  message: string;
}

/**
 * Matches raw Soroban contract errors such as `Error(Contract, #5)`.
 */
const CONTRACT_ERROR_PATTERN = /Error\(Contract,\s*#(\d+)\)/;

/**
 * Parse a raw `Error(Contract, #N)` string into a typed contract error.
 * Returns `null` when the input is not a recognizable contract error.
 */
export function parseContractError(
  raw: string,
  contract?: string,
): ContractError | null {
  const match = CONTRACT_ERROR_PATTERN.exec(raw);
  if (!match) return null;

  const code = Number(match[1]);
  const contractName = contract ?? 'escrow';
  const map = CONTRACT_ERROR_MAPS[contractName];
  const definition = map?.[code];

  if (!definition) {
    return {
      contract: contractName,
      code,
      name: `UnknownError${code}`,
      i18nKey: `contract.${contractName}.unknown`,
      message: `The ${contractName} contract returned an unknown error (code ${code}).`,
    };
  }

  return {
    contract: contractName,
    code: definition.code,
    name: definition.name,
    i18nKey: definition.i18nKey,
    message: definition.message,
  };
}

/**
 * Get a user-friendly error message from an API error,
 * with special handling for escrow contract errors.
 */
export function getErrorMessage(error: ApiError): string {
  // Translate raw contract errors first
  const contractError = parseContractError(error.message);
  if (contractError) return contractError.message;

  // Check for escrow-specific messages next
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
  contractError?: ContractError;
}

/**
 * Format an API error response for consistent error handling.
 */
export function formatApiError(
  error: ApiError | string,
): FormattedError {
  if (typeof error === 'string') {
    const contractError = parseContractError(error);
    return {
      code: contractError ? `CONTRACT_ERROR_${contractError.code}` : 'UNKNOWN_ERROR',
      message: error,
      userMessage: contractError ? contractError.message : 'An unexpected error occurred.',
      fieldErrors: {},
      ...(contractError ? { contractError } : {}),
    };
  }

  const contractError = parseContractError(error.message);
  return {
    code: contractError ? `CONTRACT_ERROR_${contractError.code}` : error.code,
    message: error.message,
    userMessage: getErrorMessage(error),
    fieldErrors: getFieldErrors(error),
    ...(contractError ? { contractError } : {}),
  };
}

/** An `Error` enriched with the API error code and any per-field validation errors. */
export interface ApiHandledError extends Error {
  code: string;
  fieldErrors: Record<string, string>;
  contractError?: ContractError;
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
    const error = new Error(formatted.userMessage) as ApiHandledError;
    error.code = formatted.code;
    error.fieldErrors = formatted.fieldErrors;
    if (formatted.contractError) {
      error.contractError = formatted.contractError;
    }

    // Track error to centralized system
    void errorTracker.captureError(error, {
      ...context,
      metadata: {
        code: formatted.code,
        fieldErrors: formatted.fieldErrors,
        ...(formatted.contractError
          ? {
              contract: formatted.contractError.contract,
              contractCode: formatted.contractError.code,
              contractName: formatted.contractError.name,
            }
          : {}),
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
