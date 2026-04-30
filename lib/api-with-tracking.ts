/**
 * API client wrapper with automatic error tracking
 * Wraps fetch calls to automatically capture and report errors
 */

import { errorTracker, type ErrorContext } from '@/lib/error-tracking';

export interface ApiCallOptions extends RequestInit {
  context?: ErrorContext;
  timeout?: number;
}

/**
 * Fetch wrapper with automatic error tracking
 */
export async function fetchWithTracking<T>(
  url: string,
  options: ApiCallOptions = {},
): Promise<T> {
  const { context, timeout = 30000, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = new Error(
        `API request failed: ${response.status} ${response.statusText}`,
      );
      (error as any).status = response.status;
      (error as any).url = url;

      await errorTracker.captureError(error, {
        ...context,
        action: 'api_call',
        metadata: {
          method: fetchOptions.method || 'GET',
          url,
          status: response.status,
        },
      });

      throw error;
    }

    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      const timeoutError = new Error(`API request timeout: ${url}`);
      await errorTracker.captureError(timeoutError, {
        ...context,
        action: 'api_timeout',
        metadata: {
          url,
          timeout,
        },
      });
      throw timeoutError;
    }

    // Re-throw with tracking
    if (error instanceof Error) {
      await errorTracker.captureError(error, {
        ...context,
        action: 'api_call',
        metadata: {
          url,
          method: fetchOptions.method || 'GET',
        },
      });
    }

    throw error;
  }
}

/**
 * Async wrapper to capture errors in async functions
 */
export async function withErrorTracking<T>(
  fn: () => Promise<T>,
  context: ErrorContext = {},
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof Error) {
      await errorTracker.captureError(error, context);
    }
    throw error;
  }
}

/**
 * Sync wrapper to capture errors in sync functions
 */
export function withErrorTrackingSync<T>(
  fn: () => T,
  context: ErrorContext = {},
): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof Error) {
      void errorTracker.captureError(error, context);
    }
    throw error;
  }
}
