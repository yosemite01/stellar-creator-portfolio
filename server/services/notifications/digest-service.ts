import type { Prisma } from '@/lib/generated/prisma/client';
/**
 * Notification digests (daily/weekly).
 *
 * Rolls up a user's unread in-app notifications (InAppNotification) into a
 * single digest instead of one email per event, per user preference
 * (NotificationPreference.digestFrequency).
 *
 * Honest scope note: there is no outbound email sender anywhere in this
 * codebase yet — `lib/email/templates/*.hbs` exist but nothing renders or
 * dispatches them (EmailDeliveryLog has zero other references in the repo
 * before this file). Rather than inventing a fake "send" that doesn't
 * actually deliver anything, `queueDigestEmails` writes one QUEUED
 * EmailDeliveryLog row per recipient with the digest payload attached —
 * that's the same durable hand-off point every other "we'll send this
 * later" flow in this schema uses. Wiring EmailDeliveryLog rows to a real
 * provider is pre-existing, unrelated work.
 */
import { prisma } from '@/lib/prisma';
import type { DigestFrequency } from '@/lib/generated/prisma/client';

export interface DigestNotificationItem {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

export interface UserDigest {
  userId: string;
  toEmail: string;
  frequency: DigestFrequency;
  notifications: DigestNotificationItem[];
}

/**
 * Build the digest for a single user: unread InAppNotification rows
 * created since their last digest (or since account creation, for a
 * first-ever digest). Returns `null` when there's nothing unread to
 * report, so callers can skip queuing an empty email.
 */
export async function buildDigestForUser(userId: string): Promise<UserDigest | null> {
  const [user, preference] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, createdAt: true } }),
    prisma.notificationPreference.findUnique({ where: { userId } }),
  ]);

  if (!user?.email || !preference) return null;
  if (preference.digestFrequency === 'NONE') return null;

  const since = preference.lastDigestSentAt ?? user.createdAt;

  const unread = await prisma.inAppNotification.findMany({
    where: {
      userId,
      read: false,
      createdAt: { gt: since },
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, title: true, body: true, createdAt: true },
  });

  if (unread.length === 0) return null;

  return {
    userId,
    toEmail: user.email,
    frequency: preference.digestFrequency,
    notifications: unread.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      createdAt: n.createdAt.toISOString(),
    })),
  };
}

function digestSubject(frequency: DigestFrequency, count: number): string {
  const period = frequency === 'WEEKLY' ? 'this week' : 'today';
  const noun = count === 1 ? 'update' : 'updates';
  return `You have ${count} new ${noun} from ${period}`;
}

/**
 * Queue (not send — see module docstring) digest emails for every user
 * whose preference matches `frequency` and who has at least one unread
 * notification since their last digest. Updates `lastDigestSentAt` for
 * every user a digest was queued for, so the next run doesn't repeat them.
 *
 * Intended to be triggered once a day (DAILY) and once a week (WEEKLY) by
 * an external scheduler — see
 * app/api/admin/cron/notification-digest/route.ts, which follows the same
 * CRON_SECRET pattern as the existing kyc-cleanup/corridor-aggregation
 * cron routes.
 */
export async function queueDigestEmails(
  frequency: Exclude<DigestFrequency, 'NONE'>,
): Promise<{ queued: number; skipped: number }> {
  const candidates = await prisma.notificationPreference.findMany({
    where: { digestFrequency: frequency, inAppEnabled: true },
    select: { userId: true },
  });

  let queued = 0;
  let skipped = 0;

  for (const { userId } of candidates) {
    const digest = await buildDigestForUser(userId);
    if (!digest) {
      skipped++;
      continue;
    }

    const now = new Date();
    await prisma.$transaction([
      prisma.emailDeliveryLog.create({
        data: {
          userId: digest.userId,
          toEmail: digest.toEmail,
          templateKey: 'notification-digest',
          subject: digestSubject(digest.frequency, digest.notifications.length),
          category: 'digest',
          status: 'QUEUED',
          // Dates serialise to ISO strings; the shape is plain JSON.
          payload: {
            frequency: digest.frequency,
            notifications: digest.notifications,
          } as unknown as Prisma.InputJsonValue,
        },
      }),
      prisma.notificationPreference.update({
        where: { userId: digest.userId },
        data: { lastDigestSentAt: now },
      }),
    ]);

    queued++;
  }

  return { queued, skipped };
}

export class DigestNotificationService {
  async buildDigestForUser(userId: string): Promise<UserDigest | null> {
    return buildDigestForUser(userId);
  }

  async queueDigestEmails(
    frequency: Exclude<DigestFrequency, 'NONE'>,
  ): Promise<{ queued: number; skipped: number }> {
    return queueDigestEmails(frequency);
  }
}
