/**
 * tRPC Client Configuration for Frontend (Issue #1827)
 * 
 * Provides unified type-safe API client with request batching,
 * resilient exponential backoff retries, and cross-cutting cache invalidation.
 */

import { createTRPCReact } from '@trpc/react-query';
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import { QueryClient } from '@tanstack/react-query';
import type { AppRouter } from '@/server/api/router';
import {
  queryKeys,
  MUTATION_INVALIDATION_MAP,
  invalidateMutationDependencies,
  type MutationEvent,
  type MutationContext,
} from './query-invalidation-map';

// ─── tRPC React Hooks ─────────────────────────────────────────────────────────

export const trpc = createTRPCReact<AppRouter>();

// ─── Client Configuration ─────────────────────────────────────────────────────

function getBaseUrl() {
  if (typeof window !== 'undefined') {
    // Browser should use relative url
    return '';
  }
  if (process.env.VERCEL_URL) {
    // SSR should use vercel url
    return `https://${process.env.VERCEL_URL}`;
  }
  // dev SSR should use localhost
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

export const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: `${getBaseUrl()}/api/trpc`,
      maxURLLength: 2083, // Standard safe max URL length for batching
      // Add auth headers
      headers: async () => {
        const token = typeof window !== 'undefined' 
          ? localStorage.getItem('auth-token')
          : null;
        
        return token ? { Authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});

// ─── Proxy Client for Server-Side Usage ──────────────────────────────────────

export const trpcProxy = createTRPCProxyClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${getBaseUrl()}/api/trpc`,
      maxURLLength: 2083,
    }),
  ],
});

// ─── Query Client with Resilient Defaults (Batching & Retries) ───────────────

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000, // 10 minutes
      retry: (failureCount, error: any) => {
        // Never retry permanent 4xx client errors, except 408 (timeout) and 429 (rate-limited)
        const status =
          error?.data?.httpStatus ??
          error?.status ??
          (error?.name === 'ApiClientError' ? error?.status : undefined);

        if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
          return false;
        }

        // Retry transient network failures and 5xx errors up to 3 times
        return failureCount < 3;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
    mutations: {
      retry: false,
    },
  },
});

// ─── Utility Hooks & Invalidation ────────────────────────────────────────────

export function useTrpcErrorHandler() {
  return {
    onError: (error: any) => {
      console.error('tRPC Error:', error);
      if (error?.data?.code === 'UNAUTHORIZED') {
        const login = new URL('/auth/login', window.location.origin);
        login.searchParams.set('callbackUrl', window.location.pathname);
        window.location.assign(login.toString());
      }
    },
  };
}

/**
 * Triggers cache invalidation for dependent views following any mutation.
 */
export async function invalidateAfterMutation(
  mutation: MutationEvent,
  ctx?: MutationContext,
): Promise<void> {
  await invalidateMutationDependencies(queryClient, mutation, ctx);
}

// ─── Type and Invalidation Exports ───────────────────────────────────────────

export {
  queryKeys,
  MUTATION_INVALIDATION_MAP,
  invalidateMutationDependencies,
  type MutationEvent,
  type MutationContext,
};
export type { AppRouter };
