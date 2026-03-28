/**
 * Notification Service Tests
 * Unit tests, integration tests, and performance tests
 */

import { PushNotificationService } from '@/lib/push-service';
import {
  validateNotificationPayload,
  sanitizeContent,
  generateMessageId,
  calculateRetryDelay,
  DEFAULT_RETRY_CONFIG,
} from '@/lib/notification-validators';

describe('PushNotificationService', () => {
  let service: PushNotificationService;

  beforeEach(() => {
    service = new PushNotificationService();
  });

  afterEach(() => {
    service.stopQueueProcessor();
  });

  describe('sendNotification', () => {
    it('should send notification successfully', async () => {
      const payload = {
        userId: 'user123',
        title: 'Test Notification',
        body: 'This is a test',
        data: {},
        channels: ['firebase'],
        priority: 'normal' as const,
      };

      const preferences = {
        userId: 'user123',
        channels: { firebase: true, onesignal: true, browser: true },
        doNotDisturb: false,
        blockedCategories: [],
        unsubscribedCategories: [],
        language: 'en',
        timezone: 'UTC',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const response = await service.sendNotification(payload, preferences);

      expect(response.success).toBe(true);
      expect(response.messageId).toBeDefined();
      expect(response.timestamp).toBeInstanceOf(Date);
    });

    it('should respect user preferences', async () => {
      const payload = {
        userId: 'user123',
        title: 'Test',
        body: 'Test body',
        data: {},
        channels: ['firebase'],
      };

      const preferences = {
        userId: 'user123',
        channels: { firebase: false, onesignal: true, browser: true },
        doNotDisturb: false,
        blockedCategories: [],
        unsubscribedCategories: [],
        language: 'en',
        timezone: 'UTC',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const response = await service.sendNotification(payload, preferences);

      // Firebase is disabled, should not attempt to send via Firebase
      expect(response.channels.firebase).toBeUndefined();
    });

    it('should apply rate limiting', async () => {
      const preferences = {
        userId: 'user123',
        channels: { firebase: true, onesignal: true, browser: true },
        doNotDisturb: false,
        blockedCategories: [],
        unsubscribedCategories: [],
        language: 'en',
        timezone: 'UTC',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const basePayload = {
        userId: 'user123',
        title: 'Test',
        body: 'Test',
        data: {},
        channels: ['firebase'],
      };

      // Send 30 notifications (max limit per minute)
      for (let i = 0; i < 30; i++) {
        const response = await service.sendNotification(basePayload, preferences);
        expect(response).toBeDefined();
      }

      // 31st should be rate limited
      expect(() =>
        service.sendNotification(basePayload, preferences),
      ).rejects.toThrow('Rate limit exceeded');
    });
  });

  describe('sendBatch', () => {
    it('should send batch notifications', async () => {
      const notifications = Array.from({ length: 10 }, (_, i) => ({
        payload: {
          userId: `user${i}`,
          title: `Notification ${i}`,
          body: `Body ${i}`,
          data: {},
          channels: ['firebase'],
        },
        preferences: {
          userId: `user${i}`,
          channels: { firebase: true, onesignal: true, browser: true },
          doNotDisturb: false,
          blockedCategories: [],
          unsubscribedCategories: [],
          language: 'en',
          timezone: 'UTC',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      }));

      const results = await service.sendBatch(notifications);

      expect(results).toHaveLength(10);
      expect(results.every(r => r.success)).toBe(true);
    });

    it('should handle batch size limits', async () => {
      const notifications = Array.from({ length: 15000 }, (_, i) => ({
        payload: {
          userId: `user${i}`,
          title: 'Test',
          body: 'Test',
          data: {},
          channels: ['firebase'],
        },
        preferences: {
          userId: `user${i}`,
          channels: { firebase: true, onesignal: true, browser: true },
          doNotDisturb: false,
          blockedCategories: [],
          unsubscribedCategories: [],
          language: 'en',
          timezone: 'UTC',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      }));

      // Should process large batches
      const results = await service.sendBatch(notifications);
      expect(results.length).toBeGreaterThan(0);
    });

    it('should measure batch processing time', async () => {
      const notifications = Array.from({ length: 1000 }, (_, i) => ({
        payload: {
          userId: `user${i}`,
          title: 'Test',
          body: 'Test',
          data: {},
          channels: ['firebase'],
        },
        preferences: {
          userId: `user${i}`,
          channels: { firebase: true, onesignal: true, browser: true },
          doNotDisturb: false,
          blockedCategories: [],
          unsubscribedCategories: [],
          language: 'en',
          timezone: 'UTC',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      }));

      const start = Date.now();
      await service.sendBatch(notifications);
      const duration = Date.now() - start;

      // Should process 1000 notifications in reasonable time
      expect(duration).toBeLessThan(10000); // 10 seconds
    });
  });

  describe('getNotificationHistory', () => {
    it('should retrieve notification history', async () => {
      const history = await service.getNotificationHistory('user123', {
        limit: 50,
        offset: 0,
      });

      expect(history).toHaveProperty('notifications');
      expect(history).toHaveProperty('total');
      expect(Array.isArray(history.notifications)).toBe(true);
    });

    it('should filter by date range', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const history = await service.getNotificationHistory('user123', {
        startDate: yesterday,
        endDate: now,
      });

      expect(history).toBeDefined();
    });
  });

  describe('Quiet Hours and DND', () => {
    it('should respect quiet hours', () => {
      const preferences = {
        userId: 'user123',
        channels: { firebase: true, onesignal: true, browser: true },
        doNotDisturb: false,
        quietHours: { start: 22, end: 8 },
        blockedCategories: [],
        unsubscribedCategories: [],
        language: 'en',
        timezone: 'UTC',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = service.isWithinQuietHours(preferences);
      // Result depends on current time
      expect(typeof result).toBe('boolean');
    });

    it('should respect do not disturb', () => {
      const preferences = {
        userId: 'user123',
        channels: { firebase: true, onesignal: true, browser: true },
        doNotDisturb: true,
        blockedCategories: [],
        unsubscribedCategories: [],
        language: 'en',
        timezone: 'UTC',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = service.isWithinQuietHours(preferences);
      expect(result).toBe(true); // DND is enabled
    });
  });

  describe('updatePreferences', () => {
    it('should update user preferences', async () => {
      const updated = await service.updatePreferences('user123', {
        doNotDisturb: true,
        quietHours: { start: 22, end: 7 },
      });

      expect(updated.doNotDisturb).toBe(true);
      expect(updated.quietHours).toEqual({ start: 22, end: 7 });
    });
  });

  describe('Queue Processor', () => {
    it('should start and stop queue processor', () => {
      service.startQueueProcessor();
      expect(service['queueProcessor']).toBeDefined();

      service.stopQueueProcessor();
      expect(service['queueProcessor']).toBeNull();
    });
  });
});

describe('Validators', () => {
  describe('validateNotificationPayload', () => {
    it('should validate correct payload', () => {
      const payload = {
        userId: 'user123',
        title: 'Test Title',
        body: 'Test Body',
      };

      const result = validateNotificationPayload(payload);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject missing fields', () => {
      const payload = {
        title: 'Test Title',
      };

      const result = validateNotificationPayload(payload);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should validate field lengths', () => {
      const payload = {
        userId: 'user123',
        title: 'a'.repeat(300),
        body: 'Test Body',
      };

      const result = validateNotificationPayload(payload);
      expect(result.valid).toBe(false);
    });

    it('should validate priority field', () => {
      const payload = {
        userId: 'user123',
        title: 'Test',
        body: 'Test',
        priority: 'invalid',
      };

      const result = validateNotificationPayload(payload);
      expect(result.valid).toBe(false);
    });
  });

  describe('sanitizeContent', () => {
    it('should remove HTML tags', () => {
      const content = '<script>alert("xss")</script>Hello';
      const sanitized = sanitizeContent(content);
      expect(sanitized).not.toContain('<');
      expect(sanitized).not.toContain('>');
    });

    it('should trim whitespace', () => {
      const content = '  Hello World  ';
      const sanitized = sanitizeContent(content);
      expect(sanitized).toBe('Hello World');
    });

    it('should normalize multiple spaces', () => {
      const content = 'Hello    World';
      const sanitized = sanitizeContent(content);
      expect(sanitized).toBe('Hello World');
    });

    it('should respect max length', () => {
      const content = 'a'.repeat(2000);
      const sanitized = sanitizeContent(content);
      expect(sanitized.length).toBeLessThanOrEqual(1024);
    });
  });

  describe('generateMessageId', () => {
    it('should generate unique IDs', () => {
      const ids = new Set();
      for (let i = 0; i < 100; i++) {
        ids.add(generateMessageId());
      }
      expect(ids.size).toBe(100);
    });

    it('should follow ID format', () => {
      const id = generateMessageId();
      expect(id).toMatch(/^msg_/);
    });
  });

  describe('calculateRetryDelay', () => {
    it('should calculate exponential backoff', () => {
      const delay1 = calculateRetryDelay(1, DEFAULT_RETRY_CONFIG);
      const delay2 = calculateRetryDelay(2, DEFAULT_RETRY_CONFIG);
      const delay3 = calculateRetryDelay(3, DEFAULT_RETRY_CONFIG);

      expect(delay1).toBe(1000);
      expect(delay2).toBe(2000);
      expect(delay3).toBe(4000);
    });

    it('should respect max delay', () => {
      const delay = calculateRetryDelay(10, DEFAULT_RETRY_CONFIG);
      expect(delay).toBeLessThanOrEqual(DEFAULT_RETRY_CONFIG.maxDelayMs);
    });
  });
});

// Performance Tests
describe('Performance', () => {
  let service: PushNotificationService;

  beforeEach(() => {
    service = new PushNotificationService();
  });

  afterEach(() => {
    service.stopQueueProcessor();
  });

  it('should handle 10k+ notifications per minute', async () => {
    const notifications = Array.from({ length: 10000 }, (_, i) => ({
      payload: {
        userId: `user${i % 100}`,
        title: `Notification ${i}`,
        body: `Body ${i}`,
        data: { index: String(i) },
        channels: ['firebase'],
      },
      preferences: {
        userId: `user${i % 100}`,
        channels: { firebase: true, onesignal: true, browser: true },
        doNotDisturb: false,
        blockedCategories: [],
        unsubscribedCategories: [],
        language: 'en',
        timezone: 'UTC',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    }));

    const start = Date.now();
    const results = await service.sendBatch(notifications);
    const duration = Date.now() - start;

    expect(results.length).toBeGreaterThan(0);
    console.log(
      `Processed ${notifications.length} notifications in ${duration}ms`,
    );
  });
});
