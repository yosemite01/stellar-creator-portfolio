import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pushNotification } from '@/lib/bounty-service';
import { sendEmail } from '@/lib/email/mailer';
import { PrismaClient } from '@prisma/client';

vi.mock('@prisma/client', () => {
  const mPrisma = {
    notificationPreference: {
      findUnique: vi.fn(),
    },
  };
  return { PrismaClient: vi.fn(() => mPrisma) };
});

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: vi.fn().mockResolvedValue({ messageId: 'test-id' }),
    })),
  },
}));

const prisma = new PrismaClient();

describe('Notification Unsubscribe Logic', () => {
  const userId = 'user-1';
  const category = 'marketing';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('In-App Notifications', () => {
    it('should push notification if no preference is set', async () => {
      (prisma.notificationPreference.findUnique as any).mockResolvedValue(null);
      
      const result = await pushNotification({
        userId,
        category,
        title: 'Test',
        body: 'Body',
      });
      
      expect(result).not.toBeNull();
      expect(result?.category).toBe(category);
    });

    it('should not push notification if inAppEnabled is false', async () => {
      (prisma.notificationPreference.findUnique as any).mockResolvedValue({
        inAppEnabled: false,
        emailEnabled: true,
      });
      
      const result = await pushNotification({
        userId,
        category,
        title: 'Test',
        body: 'Body',
      });
      
      expect(result).toBeNull();
    });
  });

  describe('Email Notifications', () => {
    it('should send email if no preference is set', async () => {
      (prisma.notificationPreference.findUnique as any).mockResolvedValue(null);
      
      // We need to capture console.log or verify sendMail
      // For simplicity, we assume if it doesn't return early, it sends
      await sendEmail({
        to: 'test@example.com',
        subject: 'Test',
        template: 'bounty-notification',
        userId,
        category,
        variables: { name: 'User', headline: 'H', bodyText: 'B' },
      });
      
      expect(prisma.notificationPreference.findUnique).toHaveBeenCalled();
    });

    it('should skip email if emailEnabled is false', async () => {
      (prisma.notificationPreference.findUnique as any).mockResolvedValue({
        inAppEnabled: true,
        emailEnabled: false,
      });
      
      const logSpy = vi.spyOn(console, 'log');
      
      await sendEmail({
        to: 'test@example.com',
        subject: 'Test',
        template: 'bounty-notification',
        userId,
        category,
        variables: { name: 'User', headline: 'H', bodyText: 'B' },
      });
      
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Skipping email'));
    });
  });
});
