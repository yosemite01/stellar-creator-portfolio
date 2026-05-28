/**
 * Push Notification Service - Secure and standard Expo notification workflows
 * Handles permissions, token registration, channels configuration, and local scheduling
 */

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

export class PushNotificationService {
  /**
   * Configure the default notification handler behavior
   * (e.g. show alert, play sound, set badge when app is in foreground)
   */
  static configureHandler() {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });
  }

  /**
   * Register the device for push notifications and get the Expo Push Token.
   */
  static async registerForPushNotificationsAsync(): Promise<{
    token: string | null;
    status: 'granted' | 'denied' | 'undetermined';
    error: string | null;
  }> {
    // 1. Check if running on a physical device (push notifications require physical device)
    if (!Device.isDevice) {
      return {
        token: null,
        status: 'undetermined',
        error: 'Must use physical device for native Push Notifications',
      };
    }

    try {
      // 2. Check and request notification permissions
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      
      if (finalStatus !== 'granted') {
        return {
          token: null,
          status: 'denied',
          error: 'Permission for push notifications was denied',
        };
      }

      // 3. Set up Android notification channel for Oreo and higher
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Default Channel',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#6366f1',
          showBadge: true,
        });
      }

      // 4. Retrieve Expo push token
      // Attempt to retrieve EAS Project ID from Expo config or EAS config
      const projectId =
        Constants.expoConfig?.extra?.eas?.projectId ??
        Constants.easConfig?.projectId;

      if (!projectId) {
        console.warn('EAS Project ID not found. Attempting registration without explicit projectId.');
      }

      const tokenData = await Notifications.getExpoPushTokenAsync({
        projectId: projectId,
      });

      return {
        token: tokenData.data,
        status: 'granted',
        error: null,
      };
    } catch (error: any) {
      console.error('Error during push notification registration:', error);
      return {
        token: null,
        status: 'granted', // permission was granted, but token generation failed
        error: error?.message || 'Failed to fetch Expo Push Token. Ensure EAS Project ID is configured in app.json.',
      };
    }
  }

  /**
   * Schedule a local notification immediately for testing/verification purposes
   */
  static async scheduleLocalNotificationAsync(
    title: string,
    body: string,
    data: Record<string, any> = {}
  ): Promise<string> {
    try {
      const notificationId = await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          data,
          sound: true,
          priority: Notifications.AndroidNotificationPriority.HIGH,
        },
        trigger: null, // trigger immediately
      });
      return notificationId;
    } catch (error: any) {
      console.error('Error scheduling local notification:', error);
      throw new Error(error?.message || 'Failed to schedule local notification');
    }
  }
}
