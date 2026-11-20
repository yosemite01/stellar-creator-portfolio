/**
 * Encrypted message store (ADR 0007).
 *
 * Messages are end-to-end encrypted: the server persists `ciphertext` + `iv`
 * as opaque blobs and never decrypts. Identity always comes from the caller's
 * session (`AuthContext`) — any `senderId`, `userId` or `moderatorId` in a
 * client payload is ignored.
 *
 * Used by the REST route (`app/api/messages/route.ts`) and the websocket
 * handler (`handleMessageEvent`). Events are fanned out across instances via
 * Redis pub/sub on {@link MESSAGES_CHANNEL} when `REDIS_URL` is set.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getRedisClient } from '@/lib/storage/redis'
import { writeAuditLog } from '@/server/services/audit'

// ── Types ────────────────────────────────────────────────────────────────────

export type Attachment = {
  name: string
  type: string
  size: number
  data: string // base64
}

export type MessagePayload = {
  id: string
  threadId: string
  senderId: string
  recipientId: string
  ciphertext: string
  iv: string
  createdAt: string
  attachment?: Attachment | null
  status?: string
  readBy?: string[]
  metadata?: Record<string, unknown>
}

/** Minimum session data required by the service. */
export type AuthContext = {
  userId: string
  role: string
}

/** Standard error shape used across the platform. */
export type ErrorResponse = { type: 'error'; code: string; message: string }
export type OkResponse = { type: string; [key: string]: unknown }
export type HandlerResponse = ErrorResponse | OkResponse

export type CreateMessageInput = {
  id?: string
  threadId?: string
  recipientId?: string
  ciphertext: string
  iv: string
  attachment?: Attachment | null
  metadata?: Record<string, unknown>
}

export type ListMessagesOptions = {
  threadId?: string
  /** Searches the client-supplied `plainText` excerpt only. */
  q?: string
  /** ISO timestamp; returns messages created before it. */
  cursor?: string
  limit?: number
}

/** Minimal socket surface the websocket handler needs. */
export type MessageSocket = { send(data: string): void }

/** A typed error the REST layer maps to an HTTP status. */
export class MessageServiceError extends Error {
  constructor(
    public readonly code: 'INVALID_PAYLOAD' | 'FORBIDDEN' | 'NOT_FOUND',
    message: string,
  ) {
    super(message)
    this.name = 'MessageServiceError'
  }
}

// ── Constants ────────────────────────────────────────────────────────────────

export const MESSAGES_CHANNEL = 'messages:events'
const ADMIN_ROLES = new Set(['ADMIN'])
const DEFAULT_THREAD = 'general'
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

// ── Helpers ──────────────────────────────────────────────────────────────────

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

type MessageRow = {
  id: string
  threadId: string
  senderId: string
  recipientId: string
  ciphertext: string
  iv: string
  createdAt: Date
  attachment: Prisma.JsonValue | null
  status: string
  readBy: string[]
  metadata: Prisma.JsonValue | null
}

function toPayload(row: MessageRow): MessagePayload {
  return {
    id: row.id,
    threadId: row.threadId,
    senderId: row.senderId,
    recipientId: row.recipientId,
    ciphertext: row.ciphertext,
    iv: row.iv,
    createdAt: row.createdAt.toISOString(),
    attachment: (row.attachment as Attachment | null) ?? null,
    status: row.status,
    readBy: row.readBy ?? [],
    metadata: (row.metadata as Record<string, unknown> | null) ?? {},
  }
}

async function ensureMember(threadId: string, userId: string): Promise<void> {
  await prisma.thread.upsert({ where: { id: threadId }, create: { id: threadId }, update: {} })
  await prisma.threadMember.upsert({
    where: { threadId_userId: { threadId, userId } },
    create: { threadId, userId },
    update: {},
  })
}

async function isMember(threadId: string, userId: string): Promise<boolean> {
  const row = await prisma.threadMember.findUnique({
    where: { threadId_userId: { threadId, userId } },
  })
  return row !== null
}

/** Publish an event to other instances. No-op without Redis. */
export async function publishMessageEvent(event: unknown): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return
  try {
    await redis.publish(MESSAGES_CHANNEL, JSON.stringify(event))
  } catch (err) {
    console.warn('[messages] publish failed', err)
  }
}

// ── REST operations ──────────────────────────────────────────────────────────

/** Persist a message from the caller and publish it. Admits the sender to the thread. */
export async function createMessage(
  auth: AuthContext,
  input: CreateMessageInput,
): Promise<MessagePayload> {
  if (!isNonEmptyString(input.ciphertext)) {
    throw new MessageServiceError('INVALID_PAYLOAD', 'ciphertext is required')
  }
  if (!isNonEmptyString(input.iv)) {
    throw new MessageServiceError('INVALID_PAYLOAD', 'iv is required')
  }

  const threadId = isNonEmptyString(input.threadId) ? input.threadId : DEFAULT_THREAD
  const metadata = input.metadata ?? {}
  const plainText =
    typeof metadata.plainText === 'string' ? metadata.plainText.slice(0, 2000) : null

  await ensureMember(threadId, auth.userId)

  const row = await prisma.message.create({
    data: {
      id: isNonEmptyString(input.id) ? input.id : crypto.randomUUID(),
      threadId,
      // Identity always comes from the session.
      senderId: auth.userId,
      recipientId: isNonEmptyString(input.recipientId) ? input.recipientId : 'all',
      ciphertext: input.ciphertext,
      iv: input.iv,
      attachment: (input.attachment ?? undefined) as Prisma.InputJsonValue | undefined,
      status: 'sent',
      readBy: [auth.userId],
      metadata: metadata as Prisma.InputJsonValue,
      plainText,
    },
  })

  const message = toPayload(row)
  await publishMessageEvent({ type: 'message', data: message })
  return message
}

/** Paginated history from threads the caller belongs to, newest first. */
export async function listMessages(
  auth: AuthContext,
  options: ListMessagesOptions = {},
): Promise<{ messages: MessagePayload[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
  const before = options.cursor ? new Date(options.cursor) : null

  const where: Prisma.MessageWhereInput = {
    thread: { members: { some: { userId: auth.userId } } },
    ...(options.threadId ? { threadId: options.threadId } : {}),
    ...(before && !Number.isNaN(before.getTime()) ? { createdAt: { lt: before } } : {}),
    ...(options.q ? { OR: [{ plainText: { contains: options.q, mode: 'insensitive' } }] } : {}),
  }

  const rows = await prisma.message.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  const messages = rows.map(toPayload)
  const nextCursor = rows.length === limit ? messages[messages.length - 1].createdAt : null
  return { messages, nextCursor }
}

/** Map a thrown error to an HTTP status and the platform error body. */
export function serviceErrorToHttp(err: unknown): {
  status: number
  body: { error: { code: string; message: string } }
} {
  if (err instanceof MessageServiceError) {
    const status = err.code === 'FORBIDDEN' ? 403 : err.code === 'NOT_FOUND' ? 404 : 400
    return { status, body: { error: { code: err.code, message: err.message } } }
  }
  console.error('[messages] unexpected error', err)
  return {
    status: 500,
    body: { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
  }
}

// ── Websocket events ─────────────────────────────────────────────────────────

async function handleMessage(raw: Record<string, unknown>, auth: AuthContext): Promise<HandlerResponse> {
  try {
    const message = await createMessage(auth, {
      id: isNonEmptyString(raw.id) ? raw.id : undefined,
      threadId: isNonEmptyString(raw.threadId) ? raw.threadId : undefined,
      recipientId: isNonEmptyString(raw.recipientId) ? raw.recipientId : undefined,
      ciphertext: typeof raw.ciphertext === 'string' ? raw.ciphertext : '',
      iv: typeof raw.iv === 'string' ? raw.iv : '',
      attachment: (raw.attachment as Attachment | null | undefined) ?? null,
      metadata:
        raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)
          ? (raw.metadata as Record<string, unknown>)
          : {},
    })
    return { type: 'message', data: message }
  } catch (err) {
    if (err instanceof MessageServiceError) {
      return { type: 'error', code: err.code, message: err.message }
    }
    throw err
  }
}

async function handleTyping(raw: Record<string, unknown>, auth: AuthContext): Promise<HandlerResponse> {
  const threadId = isNonEmptyString(raw.threadId) ? raw.threadId : DEFAULT_THREAD
  if (!(await isMember(threadId, auth.userId))) {
    return { type: 'error', code: 'FORBIDDEN', message: 'Not a member of this thread' }
  }
  const event = { type: 'typing', userId: auth.userId, threadId }
  await publishMessageEvent(event)
  return event
}

async function handleReadReceipt(raw: Record<string, unknown>, auth: AuthContext): Promise<HandlerResponse> {
  const messageId = raw.messageId
  if (!isNonEmptyString(messageId)) {
    return { type: 'error', code: 'INVALID_PAYLOAD', message: 'messageId is required' }
  }

  const target = await prisma.message.findUnique({ where: { id: messageId } })
  if (!target) {
    return { type: 'error', code: 'NOT_FOUND', message: 'Message not found' }
  }
  if (!(await isMember(target.threadId, auth.userId))) {
    return { type: 'error', code: 'FORBIDDEN', message: 'Not a member of this thread' }
  }

  await prisma.message.update({
    where: { id: messageId },
    data: {
      status: 'read',
      // Identity from session — ignore any client-supplied userId.
      readBy: Array.from(new Set([...(target.readBy ?? []), auth.userId])),
    },
  })

  const event = { type: 'read-receipt', messageId, userId: auth.userId }
  await publishMessageEvent(event)
  return event
}

async function handleModerate(raw: Record<string, unknown>, auth: AuthContext): Promise<HandlerResponse> {
  if (!ADMIN_ROLES.has(auth.role)) {
    void writeAuditLog({
      userId: auth.userId,
      resource: 'message',
      action: 'moderate',
      status: 'DENIED',
      errorMessage: `Role ${auth.role} is not permitted to moderate messages`,
      payload: { attemptedAction: raw.action ?? null, messageId: raw.messageId ?? null },
    })
    return { type: 'error', code: 'FORBIDDEN', message: 'Insufficient role to moderate messages' }
  }

  const messageId = raw.messageId
  if (!isNonEmptyString(messageId)) {
    return { type: 'error', code: 'INVALID_PAYLOAD', message: 'messageId is required' }
  }
  const action = raw.action
  if (action !== 'delete' && action !== 'hide') {
    return { type: 'error', code: 'INVALID_PAYLOAD', message: 'action must be "delete" or "hide"' }
  }
  const reason = isNonEmptyString(raw.reason) ? raw.reason : ''

  if (action === 'delete') {
    await prisma.message.delete({ where: { id: messageId } })
  } else {
    await prisma.message.update({ where: { id: messageId }, data: { status: 'hidden' } })
  }

  void writeAuditLog({
    userId: auth.userId,
    resource: 'message',
    action: `moderate:${action}`,
    resourceId: messageId,
    status: 'SUCCESS',
    payload: { action, reason, moderatorId: auth.userId },
  })

  const event = { type: 'moderated', messageId, action, moderatorId: auth.userId, reason }
  await publishMessageEvent(event)
  return event
}

async function handleJoinThread(raw: Record<string, unknown>, auth: AuthContext): Promise<HandlerResponse> {
  const threadId = isNonEmptyString(raw.threadId) ? raw.threadId : DEFAULT_THREAD
  await ensureMember(threadId, auth.userId)
  return { type: 'joined', threadId, userId: auth.userId }
}

/**
 * Process a raw websocket frame. Errors are sent back on `socket`; successful
 * events are published to other clients via {@link publishMessageEvent}.
 *
 * @param auth Server-derived identity — MUST come from the session, never the payload.
 */
export async function handleMessageEvent(
  socket: MessageSocket,
  raw: string,
  auth: AuthContext,
): Promise<void> {
  let parsed: { type?: unknown; [key: string]: unknown }
  try {
    parsed = JSON.parse(raw) as { type?: unknown; [key: string]: unknown }
  } catch {
    socket.send(JSON.stringify({ type: 'error', code: 'PARSE_ERROR', message: 'Invalid JSON payload' }))
    return
  }

  if (typeof parsed.type !== 'string' || !parsed.type) {
    socket.send(JSON.stringify({ type: 'error', code: 'INVALID_PAYLOAD', message: 'type is required' }))
    return
  }

  try {
    let result: HandlerResponse
    switch (parsed.type) {
      case 'message':
        result = await handleMessage(parsed, auth)
        break
      case 'typing':
        result = await handleTyping(parsed, auth)
        break
      case 'read-receipt':
        result = await handleReadReceipt(parsed, auth)
        break
      case 'moderate':
        result = await handleModerate(parsed, auth)
        break
      case 'join-thread':
        result = await handleJoinThread(parsed, auth)
        break
      case 'ping':
        socket.send(JSON.stringify({ type: 'pong', ts: Date.now() }))
        return
      default:
        socket.send(
          JSON.stringify({ type: 'error', code: 'UNKNOWN_EVENT', message: `Unknown event type: ${parsed.type}` }),
        )
        return
    }

    if (result.type === 'error') {
      socket.send(JSON.stringify(result))
    }
  } catch (err) {
    console.error('[messages] unhandled error processing event', { type: parsed.type, err })
    socket.send(JSON.stringify({ type: 'error', code: 'INTERNAL_ERROR', message: 'Internal server error' }))
  }
}
