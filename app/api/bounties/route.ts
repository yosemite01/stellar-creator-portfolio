import { NextRequest, NextResponse } from 'next/server'
import {
  getSupabaseClient,
  getPaginationRange,
  buildPaginatedResponse,
  getCachedAsync,
  setCacheAsync,
  invalidateCacheAsync,
} from '@/lib/db'
import { TTL } from '@/lib/storage/redis'
import {
  bountySchema,
  bountyUpdateSchema,
  bountyFilterSchema,
  paginationSchema,
  validateRequest,
  formatZodErrors,
} from '@/lib/validators'

const rateLimitMap = new Map<string, { count: number; resetTime: number }>()
const RATE_LIMIT_WINDOW_MS = 60 * 1000
const RATE_LIMIT_MAX_REQUESTS = 60

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const record = rateLimitMap.get(ip)

  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS })
    return true
  }

  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false
  }

  record.count++
  return true
}

function getClientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown'
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request)
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const params = {
      page: searchParams.get('page') || undefined,
      limit: searchParams.get('limit') || undefined,
    }

    const validation = validateRequest(paginationSchema, params)
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid parameters', details: formatZodErrors(validation.errors) },
        { status: 400 }
      )
    }

    const { page, limit } = validation.data

    const filterParams = {
      category: searchParams.get('category') || undefined,
      difficulty: searchParams.get('difficulty') || undefined,
      status: searchParams.get('status') || undefined,
      budget_min: searchParams.get('budget_min') || undefined,
      budget_max: searchParams.get('budget_max') || undefined,
      sort_by: searchParams.get('sort_by') || undefined,
      sort_order: searchParams.get('sort_order') || undefined,
    }

    const filterValidation = validateRequest(bountyFilterSchema, filterParams)
    if (!filterValidation.success) {
      return NextResponse.json(
        { error: 'Invalid filter parameters', details: formatZodErrors(filterValidation.errors) },
        { status: 400 }
      )
    }

    const { category, difficulty, status, budget_min, budget_max, sort_by, sort_order } = filterValidation.data
    const cacheKey = `bounties:${category || 'all'}:${difficulty || 'all'}:${status || 'all'}:${budget_min ?? ''}:${budget_max ?? ''}:${sort_by || 'posted_date'}:${sort_order || 'desc'}:${page}:${limit}`

    const cached = await getCachedAsync(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    const supabase = getSupabaseClient()
    const { from, to } = getPaginationRange({ page, limit })

    let query = supabase.from('bounties').select('*', { count: 'exact' })

    if (category && category !== 'All') {
      query = query.eq('category', category)
    }
    if (difficulty && difficulty !== 'All') {
      query = query.eq('difficulty', difficulty)
    }
    if (status && status !== 'All') {
      query = query.eq('status', status)
    }
    if (budget_min !== undefined) {
      query = query.gte('budget', budget_min)
    }
    if (budget_max !== undefined) {
      query = query.lte('budget', budget_max)
    }

    const { data, error, count } = await query
      .order(sort_by || 'posted_date', { ascending: sort_order === 'asc' })
      .range(from, to)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const response = buildPaginatedResponse(data || [], count || 0, { page, limit })
    await setCacheAsync(cacheKey, response, TTL.SHORT)

    return NextResponse.json(response)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request)
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  try {
    const body = await request.json()
    const validation = validateRequest(bountySchema, body)

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: formatZodErrors(validation.errors) },
        { status: 400 }
      )
    }

    const supabase = getSupabaseClient()
    const bountyData = {
      ...validation.data,
      applicants: 0,
      status: 'open' as const,
      posted_date: new Date().toISOString(),
    }

    const { data, error } = await supabase.from('bounties').insert(bountyData).select().single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await invalidateCacheAsync('bounties:')
    return NextResponse.json({ data }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  const ip = getClientIp(request)
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 })
    }

    const body = await request.json()
    const validation = validateRequest(bountyUpdateSchema, body)

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: formatZodErrors(validation.errors) },
        { status: 400 }
      )
    }

    const supabase = getSupabaseClient()
    const { data, error } = await supabase
      .from('bounties')
      .update({ ...validation.data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!data) {
      return NextResponse.json({ error: 'Bounty not found' }, { status: 404 })
    }

    await invalidateCacheAsync('bounties:')
    return NextResponse.json({ data })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  const ip = getClientIp(request)
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 })
    }

    const supabase = getSupabaseClient()
    const { error } = await supabase.from('bounties').delete().eq('id', id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await invalidateCacheAsync('bounties:')
    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
