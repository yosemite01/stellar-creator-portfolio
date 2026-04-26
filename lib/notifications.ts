import { randomBytes } from 'crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { deliverTemplatedEmail, type EmailTemplate } from '@/lib/email/mailer'
import { getRedisClient } from '@/lib/storage/redis'

const QUEUE_KEY = 'notifications:email:queue'

export type NotificationEmailCategory =
  | 'transactional'
  | 'bounty'
  | 'application'
  | 'message'
  | 'marketing'

type QueuedPayload = {
  template: EmailTemplate
  variables: Record<string, unknown>
  subject: string
  toEmail: string
  unsubscribeUrl?: string
}

function getMemoryQueue(): string[] {
  const g = globalThis as unknown as { __emailNotifyQueue?: string[] }
  if (!g.__emailNotifyQueue) g.__emailNotifyQueue = []
  return g.__emailNotifyQueue
}

async function enqueueEmailJob(logId: string): Promise<void> {
  const redis = getRedisClient()
  if (redis) {
    await redis.rpush(QUEUE_KEY, logId)
  } else {
    getMemoryQueue().push(logId)
  }
}

async function dequeueEmailJobs(max: number): Promise<string[]> {
  const redis = getRedisClient()
  const out: string[] = []
  if (redis) {
    for (let i = 0; i < max; i++) {
      const v = await redis.lpop(QUEUE_KEY)
      if (!v) break
      out.push(v)
    }
  } else {
    const q = getMemoryQueue()
    while (out.length < max && q.length > 0) {
      out.push(q.shift()!)
    }
  }
  return out
}

export async function getOrCreateUnsubscribeToken(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { emailUnsubscribeToken: true },
  })
  if (u?.emailUnsubscribeToken) return u.emailUnsubscribeToken
  const token = randomBytes(24).toString('hex')
  await prisma.user.update({
    where: { id: userId },
    data: { emailUnsubscribeToken: token },
  })
  return token
}

async function buildUnsubscribeUrl(userId: string): Promise<string> {
  const token = await getOrCreateUnsubscribeToken(userId)
  const appUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
  return `${appUrl}/api/notifications/unsubscribe?token=${encodeURIComponent(token)}`
}

export async function canSendEmailCategory(
  userId: string,
  category: NotificationEmailCategory,
): Promise<boolean> {
  if (category === 'transactional') return true
  const p = await prisma.notificationPreference.findUnique({ where: { userId } })
  if (!p) return true
  switch (category) {
    case 'bounty':
      return p.emailBountyAlerts
    case 'application':
      return p.emailApplicationUpdates
    case 'message':
      return p.emailMessages
    case 'marketing':
      return p.emailMarketing
    default:
      return true
  }
}

/**
 * Queue a templated email (or send immediately when no database is configured).
 */
export async function submitQueuedEmail(input: {
  userId: string | null
  to: string
  subject: string
  template: EmailTemplate
  variables: Record<string, unknown>
  category: NotificationEmailCategory
}): Promise<string | null> {
  const hasDb = Boolean(process.env.DATABASE_URL)

  if (!hasDb) {
    await deliverTemplatedEmail({
      to: input.to,
      subject: input.subject,
      template: input.template,
      variables: input.variables,
      unsubscribeUrl: undefined,
    })
    return null
  }

  if (input.userId && input.category !== 'transactional') {
    await prisma.notificationPreference.upsert({
      where: { userId: input.userId },
      create: { userId: input.userId },
      update: {},
    })
    const allowed = await canSendEmailCategory(input.userId, input.category)
    if (!allowed) {
      await prisma.emailDeliveryLog.create({
        data: {
          userId: input.userId,
          toEmail: input.to,
          templateKey: input.template,
          subject: input.subject,
          category: input.category,
          status: 'SKIPPED',
          payload: { reason: 'preferences_off' } as Prisma.InputJsonValue,
        },
      })
      return null
    }
  }

  let unsubscribeUrl: string | undefined
  if (input.userId && input.category !== 'transactional') {
    unsubscribeUrl = await buildUnsubscribeUrl(input.userId)
  }

  const payload: QueuedPayload = {
    template: input.template,
    variables: input.variables,
    subject: input.subject,
    toEmail: input.to,
    unsubscribeUrl,
  }

  const log = await prisma.emailDeliveryLog.create({
    data: {
      userId: input.userId,
      toEmail: input.to,
      templateKey: input.template,
      subject: input.subject,
      category: input.category,
      status: 'QUEUED',
      payload: payload as unknown as Prisma.InputJsonValue,
    },
  })

  await enqueueEmailJob(log.id)
  void processEmailQueue(20).catch((e) => console.error('[notifications] queue drain', e))
  return log.id
}

async function processOneEmailLog(id: string): Promise<boolean> {
  const log = await prisma.emailDeliveryLog.findUnique({ where: { id } })
  if (!log || log.status !== 'QUEUED') return false

  const payload = log.payload as unknown as QueuedPayload
  if (!payload?.template || !payload.toEmail || !payload.subject) {
    await prisma.emailDeliveryLog.update({
      where: { id },
      data: { status: 'FAILED', errorMessage: 'Invalid queued payload' },
    })
    return false
  }

  try {
    const result = await deliverTemplatedEmail({
      to: payload.toEmail,
      subject: payload.subject,
      template: payload.template,
      variables: payload.variables ?? {},
      unsubscribeUrl: payload.unsubscribeUrl,
    })
    await prisma.emailDeliveryLog.update({
      where: { id },
      data: {
        status: 'SENT',
        provider: result.provider,
        providerMessageId: result.messageId ?? null,
        sentAt: new Date(),
      },
    })
    return true
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await prisma.emailDeliveryLog.update({
      where: { id },
      data: { status: 'FAILED', errorMessage: msg.slice(0, 2000) },
    })
    return false
  }
}

/** Drain queued email jobs (also invoke from a cron hitting `/api/notifications/queue`). */
export async function processEmailQueue(max = 25): Promise<number> {
  let n = 0
  const ids = await dequeueEmailJobs(max)
  for (const id of ids) {
    if (await processOneEmailLog(id)) n += 1
  }
  return n
}

export async function persistInAppNotification(record: {
  id: string
  userId: string
  title: string
  body: string
  read: boolean
  applicationId?: string
  bountyId?: string
  createdAt: string
}): Promise<void> {
  if (!process.env.DATABASE_URL) return
  try {
    const pref = await prisma.notificationPreference.findUnique({
      where: { userId: record.userId },
      select: { inAppEnabled: true },
    })
    if (pref && !pref.inAppEnabled) return

    await prisma.inAppNotification.upsert({
      where: { id: record.id },
      create: {
        id: record.id,
        userId: record.userId,
        title: record.title,
        body: record.body,
        read: record.read,
        applicationId: record.applicationId ?? null,
        bountyId: record.bountyId ?? null,
        createdAt: new Date(record.createdAt),
      },
      update: {},
    })
  } catch (e) {
    console.error('[notifications] persist in-app', e)
  }
}

export async function fetchInAppNotifications(userId: string) {
  if (!process.env.DATABASE_URL) return null
  return prisma.inAppNotification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
}

export async function markInAppNotificationRead(id: string, userId: string): Promise<number> {
  if (!process.env.DATABASE_URL) return 0
  const r = await prisma.inAppNotification.updateMany({
    where: { id, userId },
    data: { read: true },
  })
  return r.count
}

export async function markAllInAppNotificationsRead(userId: string): Promise<number> {
  if (!process.env.DATABASE_URL) return 0
  const r = await prisma.inAppNotification.updateMany({
    where: { userId, read: false },
    data: { read: true },
  })
  return r.count
}

export async function getEmailDeliveryStats() {
  if (!process.env.DATABASE_URL) return null
  const [sent, failed, skipped, queued] = await Promise.all([
    prisma.emailDeliveryLog.count({ where: { status: 'SENT' } }),
    prisma.emailDeliveryLog.count({ where: { status: 'FAILED' } }),
    prisma.emailDeliveryLog.count({ where: { status: 'SKIPPED' } }),
    prisma.emailDeliveryLog.count({ where: { status: 'QUEUED' } }),
  ])
  const attempted = sent + failed
  const deliveryRate = attempted === 0 ? null : sent / attempted
  return { sent, failed, skipped, queued, deliveryRate }
}

export async function listEmailHistoryForUser(userId: string, take = 40) {
  if (!process.env.DATABASE_URL) return []
  return prisma.emailDeliveryLog.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      toEmail: true,
      templateKey: true,
      subject: true,
      category: true,
      status: true,
      provider: true,
      providerMessageId: true,
      errorMessage: true,
      createdAt: true,
      sentAt: true,
    },
  })
}
