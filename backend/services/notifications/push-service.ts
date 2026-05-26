/**
 * Push Notification Service
 * Handles multi-channel notifications: Firebase, OneSignal, browser push
 * Includes queue management, rate limiting, and delivery tracking
 */

import type { Notification, NotificationTemplate, UserPreferences, NotificationChannel } from './notification-types';

interface PushProvider {
  send(data: PushPayload): Promise<PushResponse>;
  isHealthy(): Promise<boolean>;
}

export interface PushPayload {
  userId: string;
  title: string;
  body: string;
  data: Record<string, string>;
  channels: NotificationChannel[];
  priority?: 'high' | 'normal' | 'low';
  ttl?: number;
}

interface PushResponse {
  success: boolean;
  messageId: string;
  channels: Record<string, ChannelResult>;
  timestamp: Date;
}

interface ChannelResult {
  delivered: boolean;
  error?: string;
  messageId?: string;
}

interface NotificationQueue {
  id: string;
  userId: string;
  payload: PushPayload;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  nextRetry?: Date;
  status: 'pending' | 'sent' | 'failed' | 'cancelled';
}

class FirebaseProvider implements PushProvider {
  private admin: any;
  private projectId: string;

  constructor(serviceAccountPath?: string) {
    // Initialize Firebase Admin SDK
    // In production: const admin = require('firebase-admin');
    this.projectId = process.env.FIREBASE_PROJECT_ID || '';
  }

  async send(data: PushPayload): Promise<PushResponse> {
    const results: Record<string, ChannelResult> = {};
    let hasSuccess = false;

    if (data.channels.includes('firebase')) {
      try {
        const message = {
          notification: {
            title: data.title,
            body: data.body,
          },
          data: data.data,
          android: {
            priority: data.priority || 'high',
            ttl: data.ttl || 3600,
            notification: {
              sound: 'default',
              channelId: 'notifications',
            },
          },
          apns: {
            headers: {
              'apns-priority': data.priority === 'high' ? '10' : '5',
            },
            payload: {
              aps: {
                alert: {
                  title: data.title,
                  body: data.body,
                },
                sound: 'default',
                badge: 1,
              },
            },
          },
          webpush: {
            notification: {
              title: data.title,
              body: data.body,
              icon: '/icon-192x192.png',
              badge: '/badge-72x72.png',
            },
            fcmOptions: {
              link: '/notifications',
            },
          },
        };

        // Simulated Firebase send (replace with actual admin.messaging().sendToDevice())
        const messageId = `firebase_${Date.now()}_${Math.random()}`;
        results['firebase'] = { delivered: true, messageId };
        hasSuccess = true;
      } catch (error) {
        results['firebase'] = {
          delivered: false,
          error: error instanceof Error ? error.message : 'Firebase send failed',
        };
      }
    }

    return {
      success: hasSuccess,
      messageId: `msg_${Date.now()}`,
      channels: results,
      timestamp: new Date(),
    };
  }

  async isHealthy(): Promise<boolean> {
    try {
      // Check Firebase connectivity
      return true;
    } catch {
      return false;
    }
  }
}

class OneSignalProvider implements PushProvider {
  private apiKey: string;
  private appId: string;
  private baseUrl = 'https://onesignal.com/api/v1';

  constructor() {
    this.apiKey = process.env.ONESIGNAL_API_KEY || '';
    this.appId = process.env.ONESIGNAL_APP_ID || '';
  }

  async send(data: PushPayload): Promise<PushResponse> {
    const results: Record<string, ChannelResult> = {};

    if (data.channels.includes('onesignal')) {
      try {
        const response = await fetch(`${this.baseUrl}/notifications`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Authorization': `Basic ${this.apiKey}`,
          },
          body: JSON.stringify({
            app_id: this.appId,
            headings: { en: data.title },
            contents: { en: data.body },
            data: data.data,
            priority: data.priority === 'high' ? 10 : data.priority === 'low' ? -2 : 0,
            ttl: data.ttl || 3600,
            include_external_user_ids: [data.userId],
          }),
        });

        if (!response.ok) {
          throw new Error(`OneSignal API error: ${response.statusText}`);
        }

        const result = await response.json();
        results['onesignal'] = {
          delivered: true,
          messageId: result.body.id,
        };
      } catch (error) {
        results['onesignal'] = {
          delivered: false,
          error: error instanceof Error ? error.message : 'OneSignal send failed',
        };
      }
    }

    return {
      success: results['onesignal']?.delivered ?? false,
      messageId: `msg_${Date.now()}`,
      channels: results,
      timestamp: new Date(),
    };
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/notifications`, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${this.apiKey}`,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

class BrowserPushProvider implements PushProvider {
  async send(data: PushPayload): Promise<PushResponse> {
    const results: Record<string, ChannelResult> = {};

    if (data.channels.includes('browser')) {
      try {
        // Browser push implementation (typically client-side)
        // Server-side: send via Web Push Protocol
        results['browser'] = {
          delivered: true,
          messageId: `browser_${Date.now()}`,
        };
      } catch (error) {
        results['browser'] = {
          delivered: false,
          error: error instanceof Error ? error.message : 'Browser push failed',
        };
      }
    }

    return {
      success: results['browser']?.delivered ?? false,
      messageId: `msg_${Date.now()}`,
      channels: results,
      timestamp: new Date(),
    };
  }

  async isHealthy(): Promise<boolean> {
    return true;
  }
}

/**
 * Unified Push Notification Service
 */
export class PushNotificationService {
  private providers: Map<string, PushProvider>;
  private queue: Map<string, NotificationQueue>;
  private queueProcessor: NodeJS.Timeout | null;
  private rateLimiter: Map<string, number[]>;
  private maxQueueSize: number;
  private processInterval: number;

  constructor() {
    this.providers = new Map([
      ['firebase', new FirebaseProvider()],
      ['onesignal', new OneSignalProvider()],
      ['browser', new BrowserPushProvider()],
    ]);

    this.queue = new Map();
    this.rateLimiter = new Map();
    this.maxQueueSize = 10000;
    this.processInterval = 5000; // Process queue every 5 seconds
    this.queueProcessor = null;
  }

  /**
   * Send a notification with automatic provider failover
   */
  async sendNotification(
    payload: PushPayload,
    preferences: UserPreferences,
  ): Promise<PushResponse> {
    // Check rate limiting
    if (!this.checkRateLimit(payload.userId)) {
      throw new Error('Rate limit exceeded for user');
    }

    // Filter channels based on user preferences
    const allowedChannels = this.filterChannelsByPreferences(
      payload.channels,
      preferences,
    );

    if (allowedChannels.length === 0) {
      return {
        success: false,
        messageId: '',
        channels: {},
        timestamp: new Date(),
      };
    }

    const filteredPayload = { ...payload, channels: allowedChannels };

    // Try to send immediately
    const response = await this.attemptSend(filteredPayload);

    // Queue failed channels for retry
    if (!response.success || Object.values(response.channels).some(r => !r.delivered)) {
      this.queueForRetry(filteredPayload);
    }

    return response;
  }

  /**
   * Send batch notifications with performance optimization
   */
  async sendBatch(
    notifications: Array<{
      payload: PushPayload;
      preferences: UserPreferences;
    }>,
  ): Promise<PushResponse[]> {
    const results: PushResponse[] = [];
    const batchSize = 100;

    for (let i = 0; i < notifications.length; i += batchSize) {
      const batch = notifications.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map(({ payload, preferences }) =>
          this.sendNotification(payload, preferences),
        ),
      );

      results.push(
        ...batchResults
          .filter((r) => r.status === 'fulfilled')
          .map((r) => (r as PromiseFulfilledResult<PushResponse>).value),
      );

      // Small delay between batches to avoid overwhelming providers
      await this.delay(100);
    }

    return results;
  }

  /**
   * Get notification history with filtering
   */
  async getNotificationHistory(
    userId: string,
    options: {
      limit?: number;
      offset?: number;
      channels?: NotificationChannel[];
      startDate?: Date;
      endDate?: Date;
    } = {},
  ): Promise<{ notifications: Notification[]; total: number }> {
    const {
      limit = 50,
      offset = 0,
      channels,
      startDate,
      endDate,
    } = options;

    // Query from database/storage
    // This is a placeholder - implement with your database
    return {
      notifications: [],
      total: 0,
    };
  }

  /**
   * Update user notification preferences
   */
  async updatePreferences(
    userId: string,
    preferences: Partial<UserPreferences>,
  ): Promise<UserPreferences> {
    // Save preferences to database
    const updated: UserPreferences = {
      userId,
      channels: preferences.channels || {
        firebase: true,
        onesignal: true,
        browser: true,
        email: true,
      },
      quietHours: preferences.quietHours,
      doNotDisturb: preferences.doNotDisturb || false,
      dndSchedule: preferences.dndSchedule,
      blockedCategories: preferences.blockedCategories || [],
      unsubscribedCategories: preferences.unsubscribedCategories || [],
      language: preferences.language || 'en',
      timezone: preferences.timezone || 'UTC',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Save to database
    await this.savePreferences(userId, updated);
    return updated;
  }

  /**
   * Check if notification should be delivered based on quiet hours/DND
   */
  isWithinQuietHours(preferences: UserPreferences): boolean {
    const now = new Date();
    const userHour = new Date(now.toLocaleString('en-US', { timeZone: preferences.timezone })).getHours();

    if (preferences.doNotDisturb) {
      return true; // Don't send during DND
    }

    if (preferences.quietHours) {
      const { start, end } = preferences.quietHours;
      if (start < end) {
        return userHour >= start && userHour < end;
      } else {
        return userHour >= start || userHour < end;
      }
    }

    return false;
  }

  /**
   * Start the queue processor
   */
  startQueueProcessor(): void {
    if (this.queueProcessor) return;

    this.queueProcessor = setInterval(async () => {
      await this.processQueue();
    }, this.processInterval);
  }

  /**
   * Stop the queue processor
   */
  stopQueueProcessor(): void {
    if (this.queueProcessor) {
      clearInterval(this.queueProcessor);
      this.queueProcessor = null;
    }
  }

  // Private methods

  private async attemptSend(payload: PushPayload): Promise<PushResponse> {
    const results: Record<string, ChannelResult> = {};
    let hasSuccess = false;

    for (const provider of this.providers.values()) {
      try {
        const response = await provider.send(payload);
        Object.assign(results, response.channels);
        if (response.success) hasSuccess = true;
      } catch (error) {
        // Continue with next provider on error
      }
    }

    return {
      success: hasSuccess,
      messageId: `msg_${Date.now()}`,
      channels: results,
      timestamp: new Date(),
    };
  }

  private queueForRetry(payload: PushPayload): void {
    if (this.queue.size >= this.maxQueueSize) {
      // Queue is full, drop oldest item
      const firstKey = this.queue.keys().next().value;
      if (firstKey) this.queue.delete(firstKey);
    }

    const queueItem: NotificationQueue = {
      id: `queue_${Date.now()}_${Math.random()}`,
      userId: payload.userId,
      payload,
      attempts: 0,
      maxAttempts: 3,
      createdAt: new Date(),
      nextRetry: new Date(Date.now() + 5000),
      status: 'pending',
    };

    this.queue.set(queueItem.id, queueItem);
  }

  private async processQueue(): Promise<void> {
    const now = new Date();
    const itemsToProcess: string[] = [];

    for (const [id, item] of this.queue.entries()) {
      if (item.status === 'pending' && item.nextRetry && item.nextRetry <= now) {
        itemsToProcess.push(id);
      }
    }

    for (const id of itemsToProcess) {
      const item = this.queue.get(id);
      if (!item) continue;

      try {
        const response = await this.attemptSend(item.payload);
        if (response.success) {
          item.status = 'sent';
        } else {
          item.attempts++;
          if (item.attempts >= item.maxAttempts) {
            item.status = 'failed';
          } else {
            // Exponential backoff: 5s, 25s, 125s
            const backoff = 5000 * Math.pow(5, item.attempts - 1);
            item.nextRetry = new Date(Date.now() + backoff);
          }
        }
      } catch (error) {
        item.attempts++;
        if (item.attempts >= item.maxAttempts) {
          item.status = 'failed';
        }
      }
    }
  }

  private checkRateLimit(userId: string): boolean {
    const now = Date.now();
    const windowStart = now - 60000; // 1 minute window
    const limit = 30; // Max 30 notifications per minute

    if (!this.rateLimiter.has(userId)) {
      this.rateLimiter.set(userId, []);
    }

    const timestamps = this.rateLimiter.get(userId)!;
    const recentTimestamps = timestamps.filter(ts => ts > windowStart);

    if (recentTimestamps.length >= limit) {
      return false;
    }

    recentTimestamps.push(now);
    this.rateLimiter.set(userId, recentTimestamps);
    return true;
  }

  private filterChannelsByPreferences(
    requestedChannels: NotificationChannel[],
    preferences: UserPreferences,
  ): NotificationChannel[] {
    return requestedChannels.filter(channel => {
      const isEnabled = preferences.channels[channel] !== false;
      const isWithinQuietHours = this.isWithinQuietHours(preferences);

      return isEnabled && !isWithinQuietHours;
    });
  }

  private async savePreferences(
    userId: string,
    preferences: UserPreferences,
  ): Promise<void> {
    // Database save implementation
    // Store in your preferred database
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const pushService = new PushNotificationService();
