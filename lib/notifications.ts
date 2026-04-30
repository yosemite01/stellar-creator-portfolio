// Email notification templates and service

export interface NotificationTemplate {
  id: string;
  name: string;
  subject: string;
  template: (data: any) => string;
  htmlTemplate: (data: any) => string;
}

export const notificationTemplates: Record<string, NotificationTemplate> = {
  bountyApplicationReceived: {
    id: 'bounty_application_received',
    name: 'Bounty Application Received',
    subject: 'New application for "{bountyTitle}"',
    template: (data) => `
Hello ${data.bountyPosterName},

You've received a new application for your bounty: ${data.bountyTitle}

Applicant: ${data.applicantName}
Proposed Budget: $${data.proposedBudget}
Timeline: ${data.timeline} days

Review the application: ${data.applicationLink}

Best regards,
Stellar Team
    `,
    htmlTemplate: (data) => `
<html>
  <body style="font-family: Arial, sans-serif; color: #333;">
    <h2>New Bounty Application</h2>
    <p>Hello ${data.bountyPosterName},</p>
    <p>You've received a new application for your bounty:</p>
    <h3>${data.bountyTitle}</h3>
    <p>
      <strong>Applicant:</strong> ${data.applicantName}<br>
      <strong>Proposed Budget:</strong> $${data.proposedBudget}<br>
      <strong>Timeline:</strong> ${data.timeline} days
    </p>
    <p><a href="${data.applicationLink}">Review Application</a></p>
  </body>
</html>
    `,
  },

  bountyApplicationAccepted: {
    id: 'bounty_application_accepted',
    name: 'Application Accepted',
    subject: 'Your application for "{bountyTitle}" was accepted!',
    template: (data) => `
Great news! Your application for "${data.bountyTitle}" has been accepted.

Bounty Poster: ${data.bountyPosterName}
Budget: $${data.budget}

Next Steps: ${data.nextStepsLink}

Congratulations!
Stellar Team
    `,
    htmlTemplate: (data) => `
<html>
  <body style="font-family: Arial, sans-serif; color: #333;">
    <h2>Application Accepted!</h2>
    <p>Great news! Your application has been accepted.</p>
    <h3>${data.bountyTitle}</h3>
    <p>
      <strong>Budget:</strong> $${data.budget}<br>
      <strong>Posted by:</strong> ${data.bountyPosterName}
    </p>
    <p><a href="${data.nextStepsLink}">View Next Steps</a></p>
  </body>
</html>
    `,
  },

  reviewReceived: {
    id: 'review_received',
    name: 'New Review',
    subject: 'You received a {rating} star review',
    template: (data) => `
${data.reviewerName} left a ${data.rating} star review:

"${data.reviewText}"

View your reviews: ${data.profileLink}

Stellar Team
    `,
    htmlTemplate: (data) => `
<html>
  <body style="font-family: Arial, sans-serif; color: #333;">
    <h2>New Review</h2>
    <p><strong>${data.reviewerName}</strong> left a ${data.rating} star review:</p>
    <blockquote style="background: #f5f5f5; padding: 15px; border-left: 4px solid #007bff;">
      ${data.reviewText}
    </blockquote>
    <p><a href="${data.profileLink}">View Your Reviews</a></p>
  </body>
</html>
    `,
  },

  verificationStatusChanged: {
    id: 'verification_status_changed',
    name: 'Verification Status Update',
    subject: 'Your verification status has been updated',
    template: (data) => `
Hello ${data.creatorName},

Your verification status has been updated to: ${data.status}

${
  data.status === 'verified'
    ? 'Congratulations! You can now showcase the verified badge.'
    : 'Please complete the verification requirements to get verified.'
}

Learn more: ${data.verificationLink}

Stellar Team
    `,
    htmlTemplate: (data) => `
<html>
  <body style="font-family: Arial, sans-serif; color: #333;">
    <h2>Verification Status Updated</h2>
    <p>Hello ${data.creatorName},</p>
    <p>Your verification status: <strong>${data.status}</strong></p>
    ${
      data.status === 'verified'
        ? '<p>Congratulations! You can now showcase the verified badge.</p>'
        : '<p>Please complete the verification requirements.</p>'
    }
    <p><a href="${data.verificationLink}">Learn More</a></p>
  </body>
</html>
    `,
  },
};

// Email service
export class EmailService {
  static async sendNotification(
    to: string,
    templateId: string,
    data: any
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const template = notificationTemplates[templateId];
      if (!template) {
        throw new Error(`Template ${templateId} not found`);
      }

      const response = await fetch('/api/notifications/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to,
          templateId,
          subject: template.subject.replace(/{(\w+)}/g, (_, key) => data[key] || ''),
          html: template.htmlTemplate(data),
          text: template.template(data),
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to send email');
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  static async sendBountyNotification(
    bountyPosterId: string,
    applicationData: any
  ) {
    return this.sendNotification(
      applicationData.posterEmail,
      'bounty_application_received',
      applicationData
    );
  }

  static async sendApplicationAcceptance(
    applicantId: string,
    applicationData: any
  ) {
    return this.sendNotification(
      applicationData.applicantEmail,
      'bounty_application_accepted',
      applicationData
    );
  }

  static async sendReviewNotification(creatorId: string, reviewData: any) {
    return this.sendNotification(
      reviewData.creatorEmail,
      'review_received',
      reviewData
    );
  }

  static async sendVerificationUpdate(creatorId: string, statusData: any) {
    return this.sendNotification(
      statusData.creatorEmail,
      'verification_status_changed',
      statusData
    );
  }
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
