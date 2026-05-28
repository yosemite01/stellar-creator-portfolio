/**
 * useNotifications Hook
 * React hook for managing push notifications
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import {
  NotificationService,
  PushNotificationToken,
  NotificationPermissionStatus,
} from '../services/NotificationService';

export interface UseNotificationsReturn {
  // State
  pushToken: string | null;
  permissionStatus: NotificationPermissionStatus | null;
  lastNotification: Notifications.Notification | null;
  isRegistering: boolean;
  error: string | null;

  // Actions
  registerForNotifications: () => Promise<PushNotificationToken | null>;
  requestPermissions: () => Promise<NotificationPermissionStatus>;
  sendTestNotification: () => Promise<void>;
  scheduleNotification: (
    title: string,
    body: string,
    data?: Record<string, any>,
    trigger?: Notifications.NotificationTriggerInput
  ) => Promise<string | null>;
  cancelNotification: (id: string) => Promise<void>;
  cancelAllNotifications: () => Promise<void>;
  setBadgeCount: (count: number) => Promise<void>;
  dismissAllNotifications: () => Promise<void>;
}

export const useNotifications = (): UseNotificationsReturn => {
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<NotificationPermissionStatus | null>(null);
  const [lastNotification, setLastNotification] = useState<Notifications.Notification | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const notificationListener = useRef<Notifications.Subscription>();
  const responseListener = useRef<Notifications.Subscription>();
  const isMounted = useRef(true);

  // Register for push notifications
  const registerForNotifications = useCallback(async (): Promise<PushNotificationToken | null> => {
    setIsRegistering(true);
    setError(null);

    try {
      const tokenData = await NotificationService.registerForPushNotifications();
      
      if (tokenData && isMounted.current) {
        setPushToken(tokenData.token);
        
        // Update permission status
        const status = await NotificationService.getPermissionStatus();
        setPermissionStatus(status);
        
        return tokenData;
      } else {
        setError('Failed to register for push notifications');
        return null;
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      return null;
    } finally {
      if (isMounted.current) {
        setIsRegistering(false);
      }
    }
  }, []);

  // Request permissions
  const requestPermissions = useCallback(async (): Promise<NotificationPermissionStatus> => {
    setError(null);
    
    try {
      const status = await NotificationService.requestPermissions();
      
      if (isMounted.current) {
        setPermissionStatus(status);
      }
      
      return status;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      return {
        granted: false,
        canAskAgain: false,
      };
    }
  }, []);

  // Send test notification
  const sendTestNotification = useCallback(async (): Promise<void> => {
    try {
      await NotificationService.sendNotification(
        'Test Notification',
        'This is a test notification from Stellar Creator Portfolio',
        { type: 'test', timestamp: Date.now() }
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
    }
  }, []);

  // Schedule notification
  const scheduleNotification = useCallback(
    async (
      title: string,
      body: string,
      data?: Record<string, any>,
      trigger?: Notifications.NotificationTriggerInput
    ): Promise<string | null> => {
      try {
        return await NotificationService.scheduleNotification(title, body, data, trigger);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMessage);
        return null;
      }
    },
    []
  );

  // Cancel notification
  const cancelNotification = useCallback(async (id: string): Promise<void> => {
    try {
      await NotificationService.cancelNotification(id);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
    }
  }, []);

  // Cancel all notifications
  const cancelAllNotifications = useCallback(async (): Promise<void> => {
    try {
      await NotificationService.cancelAllNotifications();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
    }
  }, []);

  // Set badge count
  const setBadgeCount = useCallback(async (count: number): Promise<void> => {
    try {
      await NotificationService.setBadgeCount(count);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
    }
  }, []);

  // Dismiss all notifications
  const dismissAllNotifications = useCallback(async (): Promise<void> => {
    try {
      await NotificationService.dismissAllNotifications();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
    }
  }, []);

  // Setup listeners on mount
  useEffect(() => {
    // Check initial permission status
    NotificationService.getPermissionStatus().then((status) => {
      if (isMounted.current) {
        setPermissionStatus(status);
      }
    });

    // Get existing token if available
    const existingToken = NotificationService.getPushToken();
    if (existingToken && isMounted.current) {
      setPushToken(existingToken);
    }

    // Listen for notifications received while app is foregrounded
    notificationListener.current = NotificationService.addNotificationReceivedListener(
      (notification) => {
        if (isMounted.current) {
          setLastNotification(notification);
        }
      }
    );

    // Listen for user interactions with notifications
    responseListener.current = NotificationService.addNotificationResponseListener(
      (response) => {
        console.log('Notification tapped:', response);
        // Handle notification tap here
        // You can navigate to specific screens based on response.notification.request.content.data
      }
    );

    // Cleanup
    return () => {
      isMounted.current = false;
      
      if (notificationListener.current) {
        NotificationService.removeNotificationSubscription(notificationListener.current);
      }
      
      if (responseListener.current) {
        NotificationService.removeNotificationSubscription(responseListener.current);
      }
    };
  }, []);

  return {
    pushToken,
    permissionStatus,
    lastNotification,
    isRegistering,
    error,
    registerForNotifications,
    requestPermissions,
    sendTestNotification,
    scheduleNotification,
    cancelNotification,
    cancelAllNotifications,
    setBadgeCount,
    dismissAllNotifications,
  };
};
