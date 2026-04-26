import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'

const prisma = new PrismaClient()

const bodySchema = z.object({
  title: z.string().min(1).max(120).optional(),
  lines: z.array(z.string().min(1)).min(1).max(12),
  relatedBountyId: z.string().optional(),
})

/**
 * Stores a match digest the user can read later (separate from global app notifications).
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  const title = parsed.data.title ?? 'New personalized matches'
  const bodyText = parsed.data.lines.slice(0, 8).join('\n')

  await prisma.matchNotification.create({
    data: {
      userId: session.user.id,
      title,
      body: bodyText,
      relatedBountyId: parsed.data.relatedBountyId ?? null,
    },
  })

  return NextResponse.json({ ok: true })
}
