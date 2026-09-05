/**
 * NOTE: this module is currently incomplete. lib/email.ts and
 * lib/email/bounty-notify.ts also import submitQueuedEmail,
 * processEmailQueue, getOrCreateUnsubscribeToken, canSendEmailCategory,
 * and a NotificationEmailCategory type from '@/lib/notifications' - none
 * of which exist yet. See docs/MAINTENANCE_NOTES.md ("lib/notifications:
 * a real email-queue subsystem is imported but was never built") before
 * assuming this file is a complete implementation of what's imported
 * from '@/lib/notifications' elsewhere.
 */
import { prisma } from '@/lib/prisma';

interface InAppNotificationInput {
  id: string;
  userId: string;
  title: string;
  body: string;
  read: boolean;
  applicationId?: string;
  bountyId?: string;
  createdAt: string;
}

/**
 * Persist a fire-and-forget copy of an in-app notification to the
 * InAppNotification table, alongside the in-memory store bounty-service.ts
 * keeps for the current process. Never throws - callers invoke this with
 * `void persistInAppNotification(record)` and don't await or catch it, so
 * a DB failure here must not become an unhandled promise rejection.
 */
export async function persistInAppNotification(
  record: InAppNotificationInput,
): Promise<void> {
  try {
    await prisma.inAppNotification.create({
      data: {
        id: record.id,
        userId: record.userId,
        title: record.title,
        body: record.body,
        read: record.read,
        applicationId: record.applicationId ?? null,
        bountyId: record.bountyId ?? null,
        createdAt: new Date(record.createdAt),
      },
    });
  } catch (error) {
    console.error('[persistInAppNotification] failed to persist notification:', error);
  }
}
