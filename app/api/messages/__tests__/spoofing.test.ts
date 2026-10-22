/**
 * Identity-spoofing regressions for message events (session identity wins).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const messageStore = new Map<string, Record<string, unknown>>()
const memberStore = new Map<string, Set<string>>()
const published: unknown[] = []

vi.mock('@/server/services/audit', () => ({
  writeAuditLog: vi.fn().mockResolvedValue({ id: 'audit-1' }),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    thread: {
      upsert: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id })),
    },
    threadMember: {
      upsert: vi.fn(
        async ({
          where,
        }: {
          where: { threadId_userId: { threadId: string; userId: string } }
        }) => {
          const key = where.threadId_userId.threadId
          const set = memberStore.get(key) ?? new Set<string>()
          set.add(where.threadId_userId.userId)
          memberStore.set(key, set)
          return where.threadId_userId
        },
      ),
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: { threadId_userId: { threadId: string; userId: string } }
        }) => {
          const set = memberStore.get(where.threadId_userId.threadId)
          if (!set?.has(where.threadId_userId.userId)) return null
          return { id: 'tm-1', ...where.threadId_userId }
        },
      ),
    },
    message: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          ...data,
          createdAt: new Date(),
          readBy: (data.readBy as string[]) ?? [],
          attachment: data.attachment ?? null,
          metadata: data.metadata ?? {},
          status: (data.status as string) ?? 'sent',
        }
        messageStore.set(String(row.id), row)
        return row
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return messageStore.get(where.id) ?? null
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const existing = messageStore.get(where.id)!
        const next = { ...existing, ...data }
        messageStore.set(where.id, next)
        return next
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const existing = messageStore.get(where.id)
        messageStore.delete(where.id)
        return existing
      }),
      findMany: vi.fn(async () => []),
    },
  },
}))

// Intercept publish to assert broadcast identity.
vi.mock('@/server/services/messages', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/services/messages')>()
  return {
    ...actual,
    publishMessageEvent: vi.fn(async (event: unknown) => {
      published.push(event)
    }),
  }
})

import { handleMessageEvent, type AuthContext } from '../message-handler'
import { writeAuditLog } from '@/server/services/audit'

class FakeSocket {
  sent: string[] = []
  send(data: string) {
    this.sent.push(data)
  }
}

function auth(overrides?: Partial<AuthContext>): AuthContext {
  return { userId: 'session-user-id', role: 'USER', ...overrides }
}

describe('handleMessageEvent — identity spoofing', () => {
  let socket: FakeSocket

  beforeEach(() => {
    socket = new FakeSocket()
    messageStore.clear()
    memberStore.clear()
    published.length = 0
    vi.clearAllMocks()
  })

  it('ignores spoofed senderId', async () => {
    await handleMessageEvent(
      socket,
      JSON.stringify({
        type: 'message',
        senderId: 'attacker',
        ciphertext: 'ct',
        iv: 'iv',
        threadId: 't1',
      }),
      auth(),
    )
    expect(Array.from(messageStore.values())[0]?.senderId).toBe('session-user-id')
  })

  it('read-receipt uses session userId', async () => {
    memberStore.set('t1', new Set(['session-user-id']))
    messageStore.set('m1', {
      id: 'm1',
      threadId: 't1',
      senderId: 'other',
      recipientId: 'session-user-id',
      ciphertext: 'x',
      iv: 'y',
      createdAt: new Date(),
      readBy: [],
      status: 'sent',
      metadata: {},
    })
    await handleMessageEvent(
      socket,
      JSON.stringify({ type: 'read-receipt', messageId: 'm1', userId: 'forged' }),
      auth(),
    )
    expect(messageStore.get('m1')!.readBy).toContain('session-user-id')
    expect(messageStore.get('m1')!.readBy).not.toContain('forged')
  })

  it('rejects non-admin moderate', async () => {
    messageStore.set('m2', {
      id: 'm2',
      threadId: 't1',
      senderId: 'x',
      recipientId: 'all',
      ciphertext: 'x',
      iv: 'y',
      createdAt: new Date(),
      readBy: [],
      status: 'sent',
      metadata: {},
    })
    await handleMessageEvent(
      socket,
      JSON.stringify({ type: 'moderate', messageId: 'm2', action: 'delete' }),
      auth(),
    )
    expect(JSON.parse(socket.sent.at(-1)!).code).toBe('FORBIDDEN')
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ status: 'DENIED' }))
    expect(messageStore.has('m2')).toBe(true)
  })

  it('blocks typing for non-members', async () => {
    await handleMessageEvent(
      socket,
      JSON.stringify({ type: 'typing', threadId: 'secret' }),
      auth(),
    )
    expect(JSON.parse(socket.sent.at(-1)!).code).toBe('FORBIDDEN')
  })
})
