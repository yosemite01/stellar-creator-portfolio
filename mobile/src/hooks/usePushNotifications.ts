/**
 * usePushNotifications Hook - Manage Push Notification lifecycle, permission states,
 * event listeners, local test notifications, and simulations.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { PushNotificationService } from '../services/PushNotificationService';

export interface NotificationLog {
  id: string;
  title: string;
  body: string;
  data: Record<string, any>;
  timestamp: number;
  type: 'push' | 'local' | 'simulated';
}

interface UsePushNotificationsReturn {
  expoPushToken: string | null;
  permissionStatus: 'granted' | 'denied' | 'undetermined';
  isDevice: boolean;
  notificationsHistory: NotificationLog[];
  isRegistering: boolean;
  error: string | null;
  registerForPushNotifications: () => Promise<void>;
  sendTestLocalNotification: (title?: string, body?: string) => Promise<void>;
  simulateRemoteNotification: (title?: string, body?: string) => void;
  clearHistory: () => void;
}

export const usePushNotifications = (): UsePushNotificationsReturn => {
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<'granted' | 'denied' | 'undetermined'>('undetermined');
  const [isDevice, setIsDevice] = useState<boolean>(true);
  const [notificationsHistory, setNotificationsHistory] = useState<NotificationLog[]>([]);
  const [isRegistering, setIsRegistering] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const notificationListener = useRef<any>();
  const responseListener = useRef<any>();

  // Check initial state, configure notification handler and register subscriptions
  useEffect(() => {
    setIsDevice(Device.isDevice);
    checkInitialPermissions();
    PushNotificationService.configureHandler();

    // 1. Foreground notification received event subscription
    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      const content = notification.request.content;
      const log: NotificationLog = {
        id: notification.request.identifier,
        title: content.title || 'Foreground Notification Received',
        body: content.body || '',
        data: content.data || {},
        timestamp: Date.now(),
        type: notification.request.trigger ? 'push' : 'local',
      };
      setNotificationsHistory(prev => [log, ...prev]);
    });

    // 2. Notification response received event subscription (tap/interaction)
    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      const content = response.notification.request.content;
      const log: NotificationLog = {
        id: `${response.notification.request.identifier}-tapped`,
        title: `Tapped: ${content.title || 'Notification'}`,
        body: content.body || '',
        data: content.data || {},
        timestamp: Date.now(),
        type: response.notification.request.trigger ? 'push' : 'local',
      };
      setNotificationsHistory(prev => [log, ...prev]);
    });

    // Cleanup subscriptions on hook unmount
    return () => {
      if (notificationListener.current) {
        Notifications.removeNotificationSubscription(notificationListener.current);
      }
      if (responseListener.current) {
        Notifications.removeNotificationSubscription(responseListener.current);
      }
    };
  }, []);

  const checkInitialPermissions = async () => {
    try {
      const { status } = await Notifications.getPermissionsAsync();
      setPermissionStatus(status as any);
    } catch (err) {
      console.error('Error fetching initial notification status:', err);
    }
  };

  /**
   * Request push notification permission and fetch registration token
   */
  const registerForPushNotifications = useCallback(async () => {
    if (isRegistering) return;
    setIsRegistering(true);
    setError(null);
    
    try {
      const result = await PushNotificationService.registerForPushNotificationsAsync();
      setPermissionStatus(result.status);
      setExpoPushToken(result.token);
      if (result.error) {
        setError(result.error);
      }
    } catch (err: any) {
      setError(err?.message || 'An error occurred during push notification setup');
    } finally {
      setIsRegistering(false);
    }
  }, [isRegistering]);

  /**
   * Schedule a local notification to test local delivery
   */
  const sendTestLocalNotification = useCallback(async (title?: string, body?: string) => {
    try {
      setError(null);
      await PushNotificationService.scheduleLocalNotificationAsync(
        title || 'Stellar Creator Portfolio Notification 🚀',
        body || 'Success! This local test notification verifies foreground/background listeners.',
        { origin: 'local-test-button', timestamp: Date.now() }
      );
    } catch (err: any) {
      setError(err?.message || 'Failed to dispatch local test notification');
    }
  }, []);

  /**
   * Inject a mock notification log immediately into the history list for emulator testing
   */
  const simulateRemoteNotification = useCallback((title?: string, body?: string) => {
    const mockLog: NotificationLog = {
      id: `sim-${Math.random().toString(36).substring(2, 9)}`,
      title: title || 'Simulated Remote Push Notification 📲',
      body: body || 'Successfully simulated remote push delivery with custom routing payload.',
      data: { remoteSimulated: true, action: 'open_project', projectId: 'project_999' },
      timestamp: Date.now(),
      type: 'simulated',
    };
    setNotificationsHistory(prev => [mockLog, ...prev]);
  }, []);

  /**
   * Clear the notifications log history list
   */
  const clearHistory = useCallback(() => {
    setNotificationsHistory([]);
  }, []);

  return {
    expoPushToken,
    permissionStatus,
    isDevice,
    notificationsHistory,
    isRegistering,
    error,
    registerForPushNotifications,
    sendTestLocalNotification,
    simulateRemoteNotification,
    clearHistory,
  };
};
