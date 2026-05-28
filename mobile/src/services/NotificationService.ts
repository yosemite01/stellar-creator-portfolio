/**
 * NotificationService - Expo Push Notification Management
 * Handles registration, permissions, and notification delivery
 */

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

// Configure notification handler
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export interface PushNotificationToken {
  token: string;
  type: 'expo' | 'fcm' | 'apns';
}

export interface NotificationPermissionStatus {
  granted: boolean;
  canAskAgain: boolean;
  ios?: {
    status: Notifications.IosAuthorizationStatus;
    allowsAlert: boolean;
    allowsBadge: boolean;
    allowsSound: boolean;
  };
}

export class NotificationService {
  private static pushToken: string | null = null;

  /**
   * Register for push notifications and get token
   */
  static async registerForPushNotifications(): Promise<PushNotificationToken | null> {
    try {
      // Check if running on physical device
      if (!Device.isDevice) {
        console.warn('Push notifications only work on physical devices');
        return null;
      }

      // Request permissions
      const permissionStatus = await this.requestPermissions();
      if (!permissionStatus.granted) {
        console.warn('Notification permissions not granted');
        return null;
      }

      // Get push token
      const tokenData = await Notifications.getExpoPushTokenAsync({
        projectId: Constants.expoConfig?.extra?.eas?.projectId,
      });

      this.pushToken = tokenData.data;

      // Configure Android notification channel
      if (Platform.OS === 'android') {
        await this.setupAndroidChannel();
      }

      return {
        token: tokenData.data,
        type: 'expo',
      };
    } catch (error) {
      console.error('Error registering for push notifications:', error);
      return null;
    }
  }

  /**
   * Request notification permissions
   */
  static async requestPermissions(): Promise<NotificationPermissionStatus> {
    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      const granted = finalStatus === 'granted';

      // Get detailed iOS permissions if available
      if (Platform.OS === 'ios') {
        const settings = await Notifications.getPermissionsAsync();
        return {
          granted,
          canAskAgain: settings.canAskAgain,
          ios: {
            status: settings.ios?.status || 0,
            allowsAlert: settings.ios?.allowsAlert || false,
            allowsBadge: settings.ios?.allowsBadge || false,
            allowsSound: settings.ios?.allowsSound || false,
          },
        };
      }

      return {
        granted,
        canAskAgain: true,
      };
    } catch (error) {
      console.error('Error requesting permissions:', error);
      return {
        granted: false,
        canAskAgain: false,
      };
    }
  }

  /**
   * Check current permission status
   */
  static async getPermissionStatus(): Promise<NotificationPermissionStatus> {
    try {
      const settings = await Notifications.getPermissionsAsync();
      const granted = settings.status === 'granted';

      if (Platform.OS === 'ios') {
        return {
          granted,
          canAskAgain: settings.canAskAgain,
          ios: {
            status: settings.ios?.status || 0,
            allowsAlert: settings.ios?.allowsAlert || false,
            allowsBadge: settings.ios?.allowsBadge || false,
            allowsSound: settings.ios?.allowsSound || false,
          },
        };
      }

      return {
        granted,
        canAskAgain: settings.canAskAgain,
      };
    } catch (error) {
      console.error('Error getting permission status:', error);
      return {
        granted: false,
        canAskAgain: false,
      };
    }
  }

  /**
   * Setup Android notification channel
   */
  private static async setupAndroidChannel(): Promise<void> {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#6366f1',
        sound: 'default',
        enableVibrate: true,
        showBadge: true,
      });

      // High priority channel for important notifications
      await Notifications.setNotificationChannelAsync('high-priority', {
        name: 'High Priority',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 500, 250, 500],
        lightColor: '#ef4444',
        sound: 'default',
        enableVibrate: true,
        showBadge: true,
      });

      // Silent channel for low priority notifications
      await Notifications.setNotificationChannelAsync('silent', {
        name: 'Silent',
        importance: Notifications.AndroidImportance.LOW,
        vibrationPattern: [0],
        sound: null,
        enableVibrate: false,
        showBadge: true,
      });
    }
  }

  /**
   * Schedule a local notification
   */
  static async scheduleNotification(
    title: string,
    body: string,
    data?: Record<string, any>,
    trigger?: Notifications.NotificationTriggerInput
  ): Promise<string | null> {
    try {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          data: data || {},
          sound: true,
          priority: Notifications.AndroidNotificationPriority.HIGH,
          vibrate: [0, 250, 250, 250],
        },
        trigger: trigger || null, // null = immediate
      });
      return id;
    } catch (error) {
      console.error('Error scheduling notification:', error);
      return null;
    }
  }

  /**
   * Send immediate local notification
   */
  static async sendNotification(
    title: string,
    body: string,
    data?: Record<string, any>
  ): Promise<string | null> {
    return this.scheduleNotification(title, body, data, null);
  }

  /**
   * Cancel a scheduled notification
   */
  static async cancelNotification(notificationId: string): Promise<void> {
    try {
      await Notifications.cancelScheduledNotificationAsync(notificationId);
    } catch (error) {
      console.error('Error canceling notification:', error);
    }
  }

  /**
   * Cancel all scheduled notifications
   */
  static async cancelAllNotifications(): Promise<void> {
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
    } catch (error) {
      console.error('Error canceling all notifications:', error);
    }
  }

  /**
   * Get all scheduled notifications
   */
  static async getScheduledNotifications(): Promise<Notifications.NotificationRequest[]> {
    try {
      return await Notifications.getAllScheduledNotificationsAsync();
    } catch (error) {
      console.error('Error getting scheduled notifications:', error);
      return [];
    }
  }

  /**
   * Set notification badge count (iOS)
   */
  static async setBadgeCount(count: number): Promise<void> {
    try {
      await Notifications.setBadgeCountAsync(count);
    } catch (error) {
      console.error('Error setting badge count:', error);
    }
  }

  /**
   * Get notification badge count (iOS)
   */
  static async getBadgeCount(): Promise<number> {
    try {
      return await Notifications.getBadgeCountAsync();
    } catch (error) {
      console.error('Error getting badge count:', error);
      return 0;
    }
  }

  /**
   * Dismiss a notification
   */
  static async dismissNotification(notificationId: string): Promise<void> {
    try {
      await Notifications.dismissNotificationAsync(notificationId);
    } catch (error) {
      console.error('Error dismissing notification:', error);
    }
  }

  /**
   * Dismiss all notifications
   */
  static async dismissAllNotifications(): Promise<void> {
    try {
      await Notifications.dismissAllNotificationsAsync();
    } catch (error) {
      console.error('Error dismissing all notifications:', error);
    }
  }

  /**
   * Get the current push token
   */
  static getPushToken(): string | null {
    return this.pushToken;
  }

  /**
   * Add notification received listener
   */
  static addNotificationReceivedListener(
    listener: (notification: Notifications.Notification) => void
  ): Notifications.Subscription {
    return Notifications.addNotificationReceivedListener(listener);
  }

  /**
   * Add notification response listener (when user taps notification)
   */
  static addNotificationResponseListener(
    listener: (response: Notifications.NotificationResponse) => void
  ): Notifications.Subscription {
    return Notifications.addNotificationResponseReceivedListener(listener);
  }

  /**
   * Remove notification listener
   */
  static removeNotificationSubscription(subscription: Notifications.Subscription): void {
    subscription.remove();
  }
}
