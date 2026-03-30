import { prisma } from '@/lib/prisma';
import { NotificationStatus } from '@prisma/client';

interface NotificationLog {
  userId: string;
  messageId: string;
  channels: Record<string, any>;
  timestamp: Date;
  status: 'sent' | 'failed' | 'batch' | 'queued';
  error?: string;
  count?: number;
  title?: string;
  body?: string;
  type?: string;
}

interface DeliveryLog {
  messageId: string;
  userId: string;
  channels: string[];
  delivered: boolean;
  duration?: number;
}

export class NotificationLogger {
  async logNotification(log: NotificationLog): Promise<void> {
    try {
      // Status mapping
      const prismaStatus = log.status === 'sent' ? NotificationStatus.SENT :
                          log.status === 'failed' ? NotificationStatus.FAILED :
                          NotificationStatus.PENDING;

      await prisma.notification.upsert({
        where: { messageId: log.messageId },
        update: {
          status: prismaStatus,
          error: log.error,
          sentAt: log.status === 'sent' ? log.timestamp : undefined,
          failedAt: log.status === 'failed' ? log.timestamp : undefined,
        },
        create: {
          messageId: log.messageId,
          userId: log.userId,
          title: log.title || 'Notification',
          body: log.body || '',
          type: log.type || 'info',
          status: prismaStatus,
          channels: Object.keys(log.channels),
          metadata: log.channels,
          sentAt: log.status === 'sent' ? log.timestamp : undefined,
          failedAt: log.status === 'failed' ? log.timestamp : undefined,
          error: log.error,
        },
      });

      console.log('[NotificationLogger]', log.messageId, log.status);
    } catch (error) {
      console.error('Failed to log notification:', error);
    }
  }

  async trackDelivery(messageId: string, status: 'sent' | 'failed' | 'opened' | 'read'): Promise<void> {
    try {
      const prismaStatus = status === 'sent' ? NotificationStatus.SENT :
                          status === 'failed' ? NotificationStatus.FAILED :
                          status === 'opened' ? NotificationStatus.OPENED :
                          status === 'read' ? NotificationStatus.READ :
                          NotificationStatus.PENDING;

      await prisma.notification.updateMany({
        where: { messageId },
        data: {
          status: prismaStatus,
          sentAt: status === 'sent' ? new Date() : undefined,
          failedAt: status === 'failed' ? new Date() : undefined,
          openedAt: status === 'opened' ? new Date() : undefined,
          readAt: status === 'read' ? new Date() : undefined,
        },
      });

      console.log('[DeliveryTracker]', messageId, status);
    } catch (error) {
      console.error('Failed to track delivery:', error);
    }
  }

  async getDeliveryStats(userId: string, days: number = 7): Promise<any> {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const stats = await prisma.notification.groupBy({
        by: ['status'],
        where: {
          userId,
          createdAt: { gte: startDate },
        },
        _count: true,
      });

      const result = {
        totalSent: 0,
        totalDelivered: 0,
        totalFailed: 0,
        totalOpened: 0,
        deliveryRate: 0,
        byChannel: {},
      };

      stats.forEach(s => {
        const count = s._count;
        if (s.status === NotificationStatus.SENT) result.totalSent += count;
        if (s.status === NotificationStatus.FAILED) result.totalFailed += count;
        if (s.status === NotificationStatus.OPENED) result.totalOpened += count;
      });

      const total = result.totalSent + result.totalFailed;
      result.totalDelivered = result.totalSent; // Assuming SENT means delivered for now
      result.deliveryRate = total > 0 ? (result.totalSent / total) * 100 : 0;

      return result;
    } catch (error) {
      console.error('Failed to get delivery stats:', error);
      return null;
    }
  }

  async auditLog(
    action: string,
    userId: string,
    details: Record<string, any>,
  ): Promise<void> {
    try {
      // Audit logging could also go to a separate AuditLog model
      console.log('[AuditLog]', action, userId, details);
    } catch (error) {
      console.error('Failed to audit log:', error);
    }
  }
}

export const logger = new NotificationLogger();

export async function logNotification(log: NotificationLog): Promise<void> {
  return logger.logNotification(log);
}

export async function trackDelivery(messageId: string, status: 'sent' | 'failed' | 'opened' | 'read'): Promise<void> {
  return logger.trackDelivery(messageId, status);
}
