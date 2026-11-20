/**
 * Unified Notification Dispatcher (#1758)
 *
 * Exposes notification persistence and multi-channel dispatch honoring
 * preferences (email, push, SMS, and in-app).
 */
import { prisma } from '@/lib/prisma';
export {
  dispatchNotification,
  notificationDispatcher,
  type DispatchNotificationRequest,
  type DispatchNotificationResult,
  type DispatchChannel,
} from '@/server/services/notifications/dispatcher';

export interface InAppNotificationInput {
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
 * InAppNotification table. Never throws.
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
