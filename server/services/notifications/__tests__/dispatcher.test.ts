import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    notificationPreference: {
      findUnique: vi.fn(),
    },
    inAppNotification: {
      create: vi.fn().mockResolvedValue({ id: 'inapp-1' }),
    },
    emailDeliveryLog: {
      create: vi.fn().mockResolvedValue({ id: 'email-1' }),
    },
  },
}));

import {
  UnifiedNotificationDispatcher,
  dispatchNotification,
} from '../dispatcher';
import { prisma } from '@/lib/prisma';

describe('UnifiedNotificationDispatcher (#1758)', () => {
  let dispatcher: UnifiedNotificationDispatcher;

  beforeEach(() => {
    vi.clearAllMocks();
    dispatcher = new UnifiedNotificationDispatcher();
  });

  it('delivers to enabled channels and records in outbox', async () => {
    vi.mocked(prisma.notificationPreference.findUnique).mockResolvedValue(null);

    const result = await dispatcher.dispatch({
      userId: 'user-123',
      recipientEmail: 'user@example.com',
      channels: ['in_app', 'email', 'push'],
      title: 'Bounty Accepted',
      body: 'Your bounty application has been accepted.',
      category: 'bounty',
    });

    expect(result.results).toHaveLength(3);
    const inAppStatus = result.results.find((r) => r.channel === 'in_app');
    const emailStatus = result.results.find((r) => r.channel === 'email');
    const pushStatus = result.results.find((r) => r.channel === 'push');

    expect(inAppStatus?.delivered).toBe(true);
    expect(emailStatus?.delivered).toBe(true);
    expect(pushStatus?.delivered).toBe(true);

    expect(prisma.inAppNotification.create).toHaveBeenCalled();
    expect(prisma.emailDeliveryLog.create).toHaveBeenCalled();
  });

  it('respects user channel opt-outs in preferences', async () => {
    vi.mocked(prisma.notificationPreference.findUnique).mockResolvedValue({
      userId: 'user-123',
      emailBountyAlerts: false, // opted out of bounty emails
      inAppEnabled: true,
    } as any);

    const result = await dispatcher.dispatch({
      userId: 'user-123',
      recipientEmail: 'user@example.com',
      channels: ['in_app', 'email'],
      title: 'New Bounty',
      body: 'A new bounty was posted',
      category: 'bounty',
    });

    const emailStatus = result.results.find((r) => r.channel === 'email');
    const inAppStatus = result.results.find((r) => r.channel === 'in_app');

    expect(emailStatus?.delivered).toBe(false);
    expect(emailStatus?.status).toBe('SKIPPED');
    expect(emailStatus?.reason).toContain('opted out');

    expect(inAppStatus?.delivered).toBe(true);
    expect(inAppStatus?.status).toBe('SENT');
  });

  it('suppresses / defers delivery during quiet hours for non-high priority', async () => {
    const isQuiet = vi.spyOn(dispatcher, 'isInQuietHours').mockReturnValue(true);

    const result = await dispatcher.dispatch({
      userId: 'user-123',
      channels: ['push', 'email'],
      title: 'Reminder',
      body: 'Quiet hours check',
      priority: 'normal',
    });

    const pushStatus = result.results.find((r) => r.channel === 'push');
    expect(pushStatus?.delivered).toBe(false);
    expect(pushStatus?.status).toBe('DEFERRED_QUIET_HOURS');

    isQuiet.mockRestore();
  });
});
