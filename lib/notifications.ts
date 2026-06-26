export type NotificationEmailCategory =
  | 'transactional'
  | 'application'
  | 'bounty'
  | 'message'
  | 'marketing'

type QueuedEmail = {
  id: string
  userId: string | null
  to: string
  subject: string
  template: string
  category: NotificationEmailCategory
  variables: Record<string, unknown>
  status: 'queued' | 'sent'
  createdAt: string
  sentAt?: string
}

type InAppNotification = {
  id: string
  userId: string
  title: string
  body: string
  read: boolean
  applicationId?: string
  bountyId?: string
  createdAt: string
}

const queuedEmails: QueuedEmail[] = []
const unsubscribeTokens = new Map<string, string>()
const inAppNotifications: InAppNotification[] = []

function randomId(): string {
  return crypto.randomUUID()
}

export async function submitQueuedEmail(params: {
  userId: string | null
  to: string
  subject: string
  template: string
  category: NotificationEmailCategory
  variables: Record<string, unknown>
}): Promise<QueuedEmail> {
  const email: QueuedEmail = {
    ...params,
    id: randomId(),
    status: 'queued',
    createdAt: new Date().toISOString(),
  }
  queuedEmails.push(email)
  return email
}

export async function processEmailQueue(): Promise<{
  processed: number
  failed: number
}> {
  let processed = 0
  const sentAt = new Date().toISOString()
  for (const email of queuedEmails) {
    if (email.status === 'queued') {
      email.status = 'sent'
      email.sentAt = sentAt
      processed += 1
    }
  }
  return { processed, failed: 0 }
}

export function getOrCreateUnsubscribeToken(userId: string): string {
  const existing = unsubscribeTokens.get(userId)
  if (existing) return existing

  const token = randomId()
  unsubscribeTokens.set(userId, token)
  return token
}

export function canSendEmailCategory(
  category: NotificationEmailCategory,
  preferences: Partial<Record<NotificationEmailCategory, boolean>> = {},
): boolean {
  return preferences[category] !== false
}

export async function persistInAppNotification(
  notification: InAppNotification,
): Promise<void> {
  inAppNotifications.push(notification)
}
