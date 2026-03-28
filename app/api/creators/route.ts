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
  creatorSchema,
  creatorUpdateSchema,
  creatorFilterSchema,
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
      discipline: searchParams.get('discipline') || undefined,
      availability: searchParams.get('availability') || undefined,
      hourly_rate_min: searchParams.get('hourly_rate_min') || undefined,
      hourly_rate_max: searchParams.get('hourly_rate_max') || undefined,
      skills: searchParams.get('skills') || undefined,
      sort_by: searchParams.get('sort_by') || undefined,
      sort_order: searchParams.get('sort_order') || undefined,
    }

    const filterValidation = validateRequest(creatorFilterSchema, filterParams)
    if (!filterValidation.success) {
      return NextResponse.json(
        { error: 'Invalid filter parameters', details: formatZodErrors(filterValidation.errors) },
        { status: 400 }
      )
    }

    const { discipline, availability, hourly_rate_min, hourly_rate_max, skills, sort_by, sort_order } = filterValidation.data
    const cacheKey = `creators:${discipline || 'all'}:${availability || 'all'}:${hourly_rate_min ?? ''}:${hourly_rate_max ?? ''}:${skills || 'all'}:${sort_by || 'created_at'}:${sort_order || 'desc'}:${page}:${limit}`

    const cached = await getCachedAsync(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    const supabase = getSupabaseClient()
    const { from, to } = getPaginationRange({ page, limit })

    let query = supabase.from('creators').select('*', { count: 'exact' })

    if (discipline && discipline !== 'All') {
      query = query.eq('discipline', discipline)
    }
    if (availability) {
      query = query.eq('availability', availability)
    }
    if (hourly_rate_min !== undefined) {
      query = query.gte('hourly_rate', hourly_rate_min)
    }
    if (hourly_rate_max !== undefined) {
      query = query.lte('hourly_rate', hourly_rate_max)
    }
    if (skills) {
      // skills is a comma-separated string; filter creators who have ALL specified skills
      const skillList = skills.split(',').map((s) => s.trim()).filter(Boolean)
      if (skillList.length > 0) {
        query = query.contains('skills', skillList)
      }
    }

    const { data, error, count } = await query
      .order(sort_by || 'created_at', { ascending: sort_order === 'asc' })
      .range(from, to)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const response = buildPaginatedResponse(data || [], count || 0, { page, limit })
    await setCacheAsync(cacheKey, response, TTL.MEDIUM)

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
    const validation = validateRequest(creatorSchema, body)

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: formatZodErrors(validation.errors) },
        { status: 400 }
      )
    }

    const supabase = getSupabaseClient()
    const { data, error } = await supabase
      .from('creators')
      .insert(validation.data)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await invalidateCacheAsync('creators:')
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
    const validation = validateRequest(creatorUpdateSchema, body)

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: formatZodErrors(validation.errors) },
        { status: 400 }
      )
    }

    const supabase = getSupabaseClient()
    const { data, error } = await supabase
      .from('creators')
      .update({ ...validation.data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!data) {
      return NextResponse.json({ error: 'Creator not found' }, { status: 404 })
    }

    await invalidateCacheAsync('creators:')
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
    const { error } = await supabase.from('creators').delete().eq('id', id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await invalidateCacheAsync('creators:')
    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
