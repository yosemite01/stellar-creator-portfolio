/**
 * Messages API — REST only (history + create).
 *
 * Live delivery is handled by the standalone realtime server
 * (`server/realtime/messages.ts`) over Redis pub/sub. See ADR 0007.
 *
 * Security
 * ────────
 * User identity is derived exclusively from the server-side session.
 * Any `userId`, `senderId`, or `moderatorId` field supplied by the client
 * is **silently ignored**.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/config'
import { requireAuth } from '@/server/services/authorization'
import {
  createMessage,
  listMessages,
  serviceErrorToHttp,
  type AuthContext,
  type CreateMessageInput,
} from '@/server/services/messages'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function resolveAuth(): Promise<AuthContext> {
  const session = await getServerSession(authOptions)
  const user = requireAuth({ user: session?.user })
  const role = user.role
  return { userId: user.id, role }
}

/**
 * GET paginated history for threads the caller belongs to.
 *
 * Query: `threadId`, `q`, `cursor` (ISO timestamp), `limit` (default 50, max 200).
 */
export async function GET(request: NextRequest) {
  const auth = await resolveAuth()

  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q')?.trim() || undefined
  const threadId = searchParams.get('threadId') ?? undefined
  const cursor = searchParams.get('cursor') ?? undefined
  const limitRaw = searchParams.get('limit')
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined

  const result = await listMessages(auth, {
    threadId,
    q,
    cursor,
    limit: Number.isFinite(limit) ? limit : undefined,
  })

  return NextResponse.json(result)
}

/**
 * POST create a message (persist, then publish over Redis).
 *
 * Identity is derived from the session — the `senderId` field in the body
 * is ignored. The sender is automatically admitted to the thread.
 */
export async function POST(request: NextRequest) {
  const auth = await resolveAuth()

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON', message: 'Invalid JSON body' } },
      { status: 400 },
    )
  }

  const input: CreateMessageInput = {
    id: typeof body.id === 'string' ? body.id : undefined,
    threadId: typeof body.threadId === 'string' ? body.threadId : undefined,
    recipientId: typeof body.recipientId === 'string' ? body.recipientId : undefined,
    ciphertext: typeof body.ciphertext === 'string' ? body.ciphertext : '',
    iv: typeof body.iv === 'string' ? body.iv : '',
    attachment:
      body.attachment && typeof body.attachment === 'object'
        ? (body.attachment as CreateMessageInput['attachment'])
        : null,
    metadata:
      body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
        ? (body.metadata as Record<string, unknown>)
        : {},
  }

  try {
    const message = await createMessage(auth, input)
    return NextResponse.json({ ok: true, message })
  } catch (err) {
    const { status, body: errorBody } = serviceErrorToHttp(err)
    return NextResponse.json(errorBody, { status })
  }
}
