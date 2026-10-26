import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const messageStore = new Map<string, Record<string, unknown>>()
const memberStore = new Map<string, Set<string>>()

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
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
          plainText:
            data.plainText ??
            ((data.metadata as { plainText?: string } | undefined)?.plainText ?? null),
        }
        messageStore.set(String(row.id), row)
        return row
      }),
      findMany: vi.fn(
        async ({
          where,
          take,
        }: {
          where?: {
            threadId?: string
            thread?: { members?: { some?: { userId?: string } } }
            OR?: Array<Record<string, unknown>>
          }
          take?: number
        }) => {
          let rows = Array.from(messageStore.values())
          if (where?.threadId) rows = rows.filter((r) => r.threadId === where.threadId)
          const userId = where?.thread?.members?.some?.userId
          if (userId) {
            rows = rows.filter((r) => memberStore.get(String(r.threadId))?.has(userId))
          }
          if (where?.OR) {
            const q = String(
              (where.OR[0] as { plainText?: { contains?: string } })?.plainText?.contains ?? '',
            ).toLowerCase()
            if (q) {
              rows = rows.filter((r) => String(r.plainText ?? '').toLowerCase().includes(q))
            }
          }
          rows.sort(
            (a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime(),
          )
          return typeof take === 'number' ? rows.slice(0, take) : rows
        },
      ),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}))

import { GET, POST } from '../route'
import { getServerSession } from 'next-auth'

describe('/api/messages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    messageStore.clear()
    memberStore.clear()
    ;(getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'client-1', role: 'USER' },
    })
  })

  it('GET returns messages', async () => {
    const res = await GET(new NextRequest('http://localhost/api/messages?threadId=general'))
    expect(res.status).toBe(200)
    expect(Array.isArray((await res.json()).messages)).toBe(true)
  })

  it('GET returns 401 when unauthenticated', async () => {
    ;(getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const res = await GET(new NextRequest('http://localhost/api/messages'))
    expect(res.status).toBe(401)
  })

  it('POST persists message with session senderId', async () => {
    const res = await POST(
      new NextRequest('http://localhost/api/messages', {
        method: 'POST',
        body: JSON.stringify({
          id: 'msg-1',
          threadId: 'general',
          senderId: 'attacker',
          ciphertext: 'ct',
          iv: 'iv',
        }),
      }),
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.message.senderId).toBe('client-1')
  })

  it('POST returns 400 when ciphertext missing', async () => {
    const res = await POST(
      new NextRequest('http://localhost/api/messages', {
        method: 'POST',
        body: JSON.stringify({ iv: 'iv' }),
      }),
    )
    expect(res.status).toBe(400)
  })
})
