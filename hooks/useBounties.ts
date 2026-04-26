'use client'

import { useQuery } from '@tanstack/react-query'

/**
 * Bounty interface matching the backend response structure
 */
export interface Bounty {
  id: string | number
  creator: string
  title: string
  description: string
  budget: number
  deadline: number
  status: 'open' | 'in_progress' | 'completed' | 'cancelled'
  applications?: number
  createdAt?: string
  updatedAt?: string
}

export interface BountiesResponse {
  bounties: Bounty[]
  total: number
  page: number
  limit: number
  filters?: {
    status?: string
    creator?: string
    minBudget?: number
    maxBudget?: number
  }
}

/**
 * Query options for bounties
 */
export interface UseBountiesOptions {
  status?: 'open' | 'in_progress' | 'completed' | 'cancelled'
  creator?: string
  minBudget?: number
  maxBudget?: number
  page?: number
  limit?: number
  enabled?: boolean
}

/**
 * API Base URL - defaults to localhost for dev, adjust for production
 */
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

/**
 * Fetches bounties from the API with optional filters
 */
async function fetchBounties(options?: UseBountiesOptions): Promise<BountiesResponse> {
  const params = new URLSearchParams()

  if (options?.status) {
    params.append('status', options.status)
  }

  if (options?.creator) {
    params.append('creator', options.creator)
  }

  if (options?.minBudget !== undefined) {
    params.append('minBudget', options.minBudget.toString())
  }

  if (options?.maxBudget !== undefined) {
    params.append('maxBudget', options.maxBudget.toString())
  }

  if (options?.page) {
    params.append('page', options.page.toString())
  }

  if (options?.limit) {
    params.append('limit', options.limit.toString())
  }

  const queryString = params.toString()
  const url = queryString
    ? `${API_BASE_URL}/api/bounties?${queryString}`
    : `${API_BASE_URL}/api/bounties`

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || `Failed to fetch bounties: ${response.statusText}`)
  }

  const data = await response.json()

  // Handle API response format
  if (data.success && data.data) {
    return data.data
  }

  throw new Error('Invalid API response format')
}

/**
 * Hook for fetching bounties with TanStack Query
 *
 * @param options - Query options including filters
 * @returns Query result with bounties data, loading, and error states
 *
 * @example
 * ```tsx
 * const { data, isLoading, error } = useBounties({ status: 'open' })
 *
 * if (isLoading) return <div>Loading...</div>
 * if (error) return <div>Error: {error.message}</div>
 *
 * return (
 *   <div>
 *     {data?.bounties.map(bounty => (
 *       <div key={bounty.id}>{bounty.title}</div>
 *     ))}
 *   </div>
 * )
 * ```
 */
export function useBounties(options?: UseBountiesOptions) {
  const queryKey = [
    'bounties',
    options?.status,
    options?.creator,
    options?.minBudget,
    options?.maxBudget,
    options?.page,
    options?.limit,
  ]

  return useQuery({
    queryKey,
    queryFn: () => fetchBounties(options),
    enabled: options?.enabled !== false,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime)
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  })
}

/**
 * Hook for fetching a single bounty by ID
 */
export function useBounty(bountyId: string | number, enabled = true) {
  return useQuery({
    queryKey: ['bounty', bountyId],
    queryFn: async () => {
      const response = await fetch(`${API_BASE_URL}/api/bounties/${bountyId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || `Failed to fetch bounty: ${response.statusText}`)
      }

      const data = await response.json()

      if (data.success && data.data) {
        return data.data as Bounty
      }

      throw new Error('Invalid API response format')
    },
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  })
}
