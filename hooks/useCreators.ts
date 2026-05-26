'use client'

import { useQuery } from '@tanstack/react-query'

/**
 * Creator interface matching the backend response structure
 */
export interface CreatorStats {
  projects: number
  clients: number
  experience: number
}

export interface Project {
  id: string
  title: string
  description: string
  category: string
  image: string
  link?: string
  tags: string[]
  year: number
}

export interface Creator {
  id: string
  name: string
  title: string
  discipline: string
  bio: string
  avatar: string
  coverImage: string
  tagline: string
  linkedIn: string
  twitter: string
  portfolio?: string
  projects: Project[]
  skills: string[]
  stats?: CreatorStats
  hourlyRate?: number
  responseTime?: string
  availability?: 'available' | 'limited' | 'unavailable'
  rating?: number
  reviewCount?: number
}

export interface CreatorsResponse {
  creators: Creator[]
  total: number
  filters: {
    discipline?: string
    search?: string
  }
}

/**
 * Query options for creators
 */
export interface UseCreatorsOptions {
  discipline?: string
  search?: string
  enabled?: boolean
}

/**
 * API Base URL - defaults to localhost for dev, adjust for production
 */
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

/**
 * Fetches creators from the API with optional filters
 */
async function fetchCreators(options?: UseCreatorsOptions): Promise<CreatorsResponse> {
  const params = new URLSearchParams()

  if (options?.discipline) {
    params.append('discipline', options.discipline)
  }

  if (options?.search) {
    params.append('search', options.search)
  }

  const queryString = params.toString()
  const url = queryString ? `${API_BASE_URL}/api/creators?${queryString}` : `${API_BASE_URL}/api/creators`

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || `Failed to fetch creators: ${response.statusText}`)
  }

  const data = await response.json()

  // Handle API response format
  if (data.success && data.data) {
    return data.data
  }

  throw new Error('Invalid API response format')
}

/**
 * Hook for fetching creators with TanStack Query
 *
 * @param options - Query options including filters
 * @returns Query result with creators data, loading, and error states
 *
 * @example
 * ```tsx
 * const { data, isLoading, error } = useCreators({ discipline: 'UI/UX Design' })
 *
 * if (isLoading) return <div>Loading...</div>
 * if (error) return <div>Error: {error.message}</div>
 *
 * return (
 *   <div>
 *     {data?.creators.map(creator => (
 *       <div key={creator.id}>{creator.name}</div>
 *     ))}
 *   </div>
 * )
 * ```
 */
export function useCreators(options?: UseCreatorsOptions) {
  const queryKey = ['creators', options?.discipline, options?.search]

  return useQuery({
    queryKey,
    queryFn: () => fetchCreators(options),
    enabled: options?.enabled !== false,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime)
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  })
}

/**
 * Hook for fetching a single creator by ID
 */
export function useCreator(creatorId: string, enabled = true) {
  return useQuery({
    queryKey: ['creator', creatorId],
    queryFn: async () => {
      const response = await fetch(`${API_BASE_URL}/api/creators/${creatorId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || `Failed to fetch creator: ${response.statusText}`)
      }

      const data = await response.json()

      if (data.success && data.data) {
        return data.data as Creator
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
