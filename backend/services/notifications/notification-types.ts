/**
 * Notification System Types
 * Comprehensive type definitions for the notification service
 */

export type NotificationChannel = 'firebase' | 'onesignal' | 'browser' | 'email';
export type NotificationType = 'message' | 'update' | 'reminder' | 'alert' | 'info';
export type NotificationStatus = 'unread' | 'read' | 'archived' | 'deleted' | 'sent' | 'failed';
export type NotificationPriority = 'high' | 'normal' | 'low';

/**
 * Core Notification interface
 */
export interface Notification {
  id: string;
  userId: string;
  title: string;
  body: string;
  type: NotificationType;
  status: NotificationStatus;
  priority: NotificationPriority;
  channels: NotificationChannel[];
  timestamp: Date;
  actionUrl?: string;
  actionLabel?: string;
  imageUrl?: string;
  metadata?: Record<string, any>;
  readAt?: Date;
  archivedAt?: Date;
  deletedAt?: Date;
}

/**
 * User notification preferences
 */
export interface UserPreferences {
  userId: string;
  channels: Record<NotificationChannel, boolean>;
  quietHours?: {
    start: number; // 0-23 hours
    end: number; // 0-23 hours
  };
  doNotDisturb: boolean;
  dndSchedule?: {
    enabled: boolean;
    start: string; // HH:mm format
    end: string; // HH:mm format
    days: number[]; // 0-6 (Sunday-Saturday)
  };
  blockedCategories: string[];
  unsubscribedCategories: string[];
  language: string;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Notification template
 */
export interface NotificationTemplate {
  id: string;
  name: string;
  description?: string;
  title: string;
  body: string;
  type: NotificationType;
  priority: NotificationPriority;
  channels: NotificationChannel[];
  variables?: string[];
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Request payload for sending notification
 */
export interface SendNotificationRequest {
  userId: string;
  title: string;
  body: string;
  type?: NotificationType;
  priority?: NotificationPriority;
  channels?: NotificationChannel[];
  data?: Record<string, string>;
  actionUrl?: string;
  actionLabel?: string;
  imageUrl?: string;
  templateId?: string;
  templateVariables?: Record<string, string>;
  metadata?: Record<string, any>;
}

/**
 * Batch send request
 */
export interface BatchSendRequest {
  notifications: SendNotificationRequest[];
  dryRun?: boolean;
  priority?: 'high' | 'normal';
}

/**
 * Notification delivery response
 */
export interface NotificationResponse {
  success: boolean;
  messageId: string;
  channels: Record<NotificationChannel, ChannelDeliveryResult>;
  timestamp: Date;
  error?: string;
}

/**
 * Per-channel delivery result
 */
export interface ChannelDeliveryResult {
  delivered: boolean;
  messageId?: string;
  error?: string;
  retryable?: boolean;
  nextRetryAt?: Date;
}

/**
 * Notification history query options
 */
export interface NotificationHistoryQuery {
  userId: string;
  limit?: number;
  offset?: number;
  statuses?: NotificationStatus[];
  types?: NotificationType[];
  channels?: NotificationChannel[];
  startDate?: Date;
  endDate?: Date;
  sortBy?: 'newest' | 'oldest' | 'priority';
}

/**
 * Notification statistics
 */
export interface NotificationStats {
  userId: string;
  totalNotifications: number;
  unreadCount: number;
  readCount: number;
  archivedCount: number;
  byType: Record<NotificationType, number>;
  byChannel: Record<NotificationChannel, number>;
  deliveryRate: number;
  averageDeliveryTime: number;
  lastNotificationAt?: Date;
}

/**
 * Rate limiting configuration
 */
export interface RateLimitConfig {
  maxPerMinute: number;
  maxPerHour: number;
  maxPerDay: number;
  burstAllowance: number;
}

/**
 * Service provider configuration
 */
export interface ProviderConfig {
  firebase?: {
    projectId: string;
    serviceAccount?: string;
    credentialsPath?: string;
  };
  onesignal?: {
    appId: string;
    apiKey: string;
  };
  browser?: {
    publicKey: string;
    privateKey: string;
  };
  email?: {
    provider: 'sendgrid' | 'mailgun' | 'ses' | 'smtp';
    apiKey?: string;
    apiSecret?: string;
    senderEmail?: string;
  };
}

/**
 * Notification event for real-time updates
 */
export interface NotificationEvent {
  type: 'notification:created' | 'notification:delivered' | 'notification:read' | 'notification:failed';
  notification: Notification;
  timestamp: Date;
  channel?: NotificationChannel;
  metadata?: Record<string, any>;
}

/**
 * Database models (for ORM integration)
 */
export interface NotificationRecord {
  id: string;
  userId: string;
  title: string;
  body: string;
  type: NotificationType;
  status: NotificationStatus;
  priority: NotificationPriority;
  channels: string; // JSON string
  timestamp: Date;
  actionUrl?: string;
  actionLabel?: string;
  imageUrl?: string;
  metadata?: string; // JSON string
  readAt?: Date;
  archivedAt?: Date;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserPreferencesRecord {
  id: string;
  userId: string;
  channels: string; // JSON string
  quietHours?: string; // JSON string
  doNotDisturb: boolean;
  dndSchedule?: string; // JSON string
  blockedCategories: string; // JSON array string
  unsubscribedCategories: string; // JSON array string
  language: string;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationTemplateRecord {
  id: string;
  name: string;
  description?: string;
  title: string;
  body: string;
  type: NotificationType;
  priority: NotificationPriority;
  channels: string; // JSON array string
  variables?: string; // JSON array string
  metadata?: string; // JSON string
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Error types
 */
export class NotificationError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public retryable: boolean = false,
  ) {
    super(message);
    this.name = 'NotificationError';
  }
}

export class ValidationError extends NotificationError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400, false);
    this.name = 'ValidationError';
  }
}

export class RateLimitError extends NotificationError {
  constructor(
    message: string,
    public retryAfter: number,
  ) {
    super(message, 'RATE_LIMIT_ERROR', 429, true);
    this.name = 'RateLimitError';
  }
}

export class DeliveryError extends NotificationError {
  constructor(
    message: string,
    public channel: NotificationChannel,
    retryable: boolean = true,
  ) {
    super(message, 'DELIVERY_ERROR', 503, retryable);
    this.name = 'DeliveryError';
  }
}
