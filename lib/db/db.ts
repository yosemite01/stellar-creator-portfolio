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

// ── In-memory fallback cache (used when Redis is unavailable) ─────────────────
const memCache = new Map<string, { data: unknown; timestamp: number }>()
const MEM_CACHE_TTL_MS = 60 * 1000

function memGet<T>(key: string): T | null {
  const entry = memCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.timestamp > MEM_CACHE_TTL_MS) {
    memCache.delete(key)
    return null
  }
  return entry.data as T
}

function memSet<T>(key: string, data: T): void {
  memCache.set(key, { data, timestamp: Date.now() })
}

function memInvalidate(pattern?: string): void {
  if (!pattern) { memCache.clear(); return }
  for (const key of memCache.keys()) {
    if (key.includes(pattern)) memCache.delete(key)
  }
}

// ── Public cache API (Redis-first, in-memory fallback) ────────────────────────
import { redisGet, redisSet, redisDel, TTL } from '@/lib/storage/redis'

/**
 * Synchronous read — checks in-memory cache only.
 * Use `getCachedAsync` in API routes for Redis-backed reads.
 */
export function getCached<T>(key: string): T | null {
  return memGet<T>(key)
}

/**
 * Async read — checks Redis first, falls back to in-memory.
 */
export async function getCachedAsync<T>(key: string): Promise<T | null> {
  const fromRedis = await redisGet<T>(key)
  if (fromRedis !== null) return fromRedis
  return memGet<T>(key)
}

/**
 * Synchronous write — writes to in-memory cache only.
 * Use `setCacheAsync` in API routes for Redis-backed writes.
 */
export function setCache<T>(key: string, data: T): void {
  memSet(key, data)
}

/**
 * Async write — writes to both Redis and in-memory.
 */
export async function setCacheAsync<T>(
  key: string,
  data: T,
  ttlSeconds: number = TTL.MEDIUM,
): Promise<void> {
  await redisSet(key, data, ttlSeconds)
  memSet(key, data)
}

/**
 * Synchronous invalidation — clears in-memory cache only.
 * Use `invalidateCacheAsync` in API routes for full invalidation.
 */
export function invalidateCache(pattern?: string): void {
  memInvalidate(pattern)
}

/**
 * Async invalidation — clears both Redis (glob pattern) and in-memory.
 */
export async function invalidateCacheAsync(pattern?: string): Promise<void> {
  const redisPattern = pattern ? `${pattern}*` : '*'
  await redisDel(redisPattern)
  memInvalidate(pattern)
}
