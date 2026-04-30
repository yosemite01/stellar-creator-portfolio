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
  userSchema,
  userUpdateSchema,
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
    const id = searchParams.get('id')

    if (id) {
      const cacheKey = `user:${id}`
      const cached = await getCachedAsync(cacheKey)
      if (cached) {
        return NextResponse.json({ data: cached })
      }

      const supabase = getSupabaseClient()
      const { data, error } = await supabase.from('users').select('*').eq('id', id).single()

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      if (!data) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 })
      }

      await setCacheAsync(cacheKey, data, TTL.MEDIUM)
      return NextResponse.json({ data })
    }

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
    const role = searchParams.get('role')
    const cacheKey = `users:${role || 'all'}:${page}:${limit}`

    const cached = await getCachedAsync(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    const supabase = getSupabaseClient()
    const { from, to } = getPaginationRange({ page, limit })

    let query = supabase.from('users').select('*', { count: 'exact' })

    if (role && role !== 'All') {
      query = query.eq('role', role)
    }

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
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
    const validation = validateRequest(userSchema, body)

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: formatZodErrors(validation.errors) },
        { status: 400 }
      )
    }

    const supabase = getSupabaseClient()

    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', validation.data.email)
      .single()

    if (existing) {
      return NextResponse.json({ error: 'Email already exists' }, { status: 409 })
    }

    const { data, error } = await supabase.from('users').insert(validation.data).select().single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await invalidateCacheAsync('users:')
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
    const validation = validateRequest(userUpdateSchema, body)

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: formatZodErrors(validation.errors) },
        { status: 400 }
      )
    }

    const supabase = getSupabaseClient()

    if (validation.data.email) {
      const { data: existing } = await supabase
        .from('users')
        .select('id')
        .eq('email', validation.data.email)
        .neq('id', id)
        .single()

      if (existing) {
        return NextResponse.json({ error: 'Email already exists' }, { status: 409 })
      }
    }

    const { data, error } = await supabase
      .from('users')
      .update({ ...validation.data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!data) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    await invalidateCacheAsync('users:')
    await invalidateCacheAsync(`user:${id}`)
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
    const { error } = await supabase.from('users').delete().eq('id', id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await invalidateCacheAsync('users:')
    await invalidateCacheAsync(`user:${id}`)
    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
