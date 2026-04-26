/**
 * Notification Validators and Sanitizers
 */

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateNotificationPayload(payload: any): ValidationResult {
  const errors: string[] = [];

  if (!payload.userId || typeof payload.userId !== 'string') {
    errors.push('userId is required and must be a string');
  }

  if (!payload.title || typeof payload.title !== 'string') {
    errors.push('title is required and must be a string');
  }

  if (!payload.body || typeof payload.body !== 'string') {
    errors.push('body is required and must be a string');
  }

  if (payload.title && payload.title.length > 256) {
    errors.push('title must not exceed 256 characters');
  }

  if (payload.body && payload.body.length > 1024) {
    errors.push('body must not exceed 1024 characters');
  }

  if (payload.priority && !['high', 'normal', 'low'].includes(payload.priority)) {
    errors.push('priority must be one of: high, normal, low');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function sanitizeContent(content: string): string {
  if (!content) return '';
  return content
    .trim()
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .substring(0, 1024);
}

export function validateUserPreferences(preferences: any): ValidationResult {
  const errors: string[] = [];

  if (preferences.channels && typeof preferences.channels !== 'object') {
    errors.push('channels must be an object');
  }

  if (preferences.timezone && typeof preferences.timezone !== 'string') {
    errors.push('timezone must be a string');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

export function calculateRetryDelay(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
): number {
  const exponentialDelay =
    config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt - 1);
  return Math.min(exponentialDelay, config.maxDelayMs);
}
