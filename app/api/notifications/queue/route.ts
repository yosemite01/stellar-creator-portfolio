import { NextRequest, NextResponse } from 'next/server'
import { processEmailQueue } from '@/lib/notifications'

/** Drain queued emails — call from Vercel Cron with `Authorization: Bearer $CRON_SECRET`. */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 })
  }
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const processed = await processEmailQueue(50)
  return NextResponse.json({ ok: true, processed })
}
