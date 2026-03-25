import { createClient, SupabaseClient } from '@supabase/supabase-js'

export interface Database {
  creators: {
    id: string
    name: string
    title: string
    discipline: string
    bio: string
    avatar: string
    cover_image: string
    tagline: string
    linked_in: string
    twitter: string
    portfolio: string | null
    skills: string[]
    hourly_rate: number | null
    response_time: string | null
    availability: 'available' | 'limited' | 'unavailable' | null
    rating: number | null
    review_count: number | null
    stats_projects: number | null
    stats_clients: number | null
    stats_experience: number | null
    created_at: string
    updated_at: string
  }
  bounties: {
    id: string
    title: string
    description: string
    budget: number
    currency: string
    deadline: string
    difficulty: 'beginner' | 'intermediate' | 'advanced' | 'expert'
    category: string
    tags: string[]
    applicants: number
    status: 'open' | 'in-progress' | 'completed' | 'cancelled'
    posted_by: string
    posted_date: string
    required_skills: string[]
    deliverables: string
    created_at: string
    updated_at: string
  }
  users: {
    id: string
    email: string
    wallet_address: string | null
    display_name: string
    avatar_url: string | null
    role: 'creator' | 'client' | 'admin'
    created_at: string
    updated_at: string
  }
  applications: {
    id: string
    bounty_id: string
    creator_id: string
    proposed_budget: number
    timeline: number
    proposal: string
    status: 'pending' | 'accepted' | 'rejected'
    applied_date: string
    created_at: string
    updated_at: string
  }
}

let supabaseClient: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient {
  if (supabaseClient) {
    return supabaseClient
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables')
  }

  supabaseClient = createClient(supabaseUrl, supabaseKey)
  return supabaseClient
}

export interface PaginationParams {
  page?: number
  limit?: number
}

export interface PaginatedResponse<T> {
  data: T[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export function getPaginationRange(params: PaginationParams): { from: number; to: number } {
  const page = Math.max(1, params.page || 1)
  const limit = Math.min(100, Math.max(1, params.limit || 10))
  const from = (page - 1) * limit
  const to = from + limit - 1
  return { from, to }
}

export function buildPaginatedResponse<T>(
  data: T[],
  total: number,
  params: PaginationParams
): PaginatedResponse<T> {
  const page = Math.max(1, params.page || 1)
  const limit = Math.min(100, Math.max(1, params.limit || 10))
  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  }
}

const cache = new Map<string, { data: unknown; timestamp: number }>()
const CACHE_TTL_MS = 60 * 1000

export function getCached<T>(key: string): T | null {
  const cached = cache.get(key)
  if (!cached) return null
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }
  return cached.data as T
}

export function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() })
}

export function invalidateCache(pattern?: string): void {
  if (!pattern) {
    cache.clear()
    return
  }
  for (const key of cache.keys()) {
    if (key.includes(pattern)) {
      cache.delete(key)
    }
  }
}
