/**
 * Unit tests for PushNotificationService
 */

// Module-level flag to control Device.isDevice across tests
let mockIsDevice = true;

jest.mock('react-native', () => ({
  Platform: {
    OS: 'ios',
  },
  Clipboard: {
    setString: jest.fn(),
  },
}));

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
  AndroidImportance: { MAX: 5 },
  AndroidNotificationPriority: { HIGH: 4 },
}));

// Use a getter so each test can toggle mockIsDevice reliably
jest.mock('expo-device', () => ({
  get isDevice() {
    return mockIsDevice;
  },
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        eas: {
          projectId: 'test-project-id',
        },
      },
    },
  },
}));

import { PushNotificationService } from '../src/services/PushNotificationService';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

describe('PushNotificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset device flag to true before each test
    mockIsDevice = true;
  });

  afterEach(() => {
    // Guarantee cleanup in case a test fails mid-way
    mockIsDevice = true;
  });

  describe('configureHandler', () => {
    it('should configure the default notification handler', () => {
      PushNotificationService.configureHandler();
      expect(Notifications.setNotificationHandler).toHaveBeenCalled();
    });
  });

  describe('registerForPushNotificationsAsync', () => {
    it('should fail if not running on a physical device', async () => {
      // Set mockIsDevice to false — getter in jest.mock picks this up
      mockIsDevice = false;

      const result = await PushNotificationService.registerForPushNotificationsAsync();
      expect(result.token).toBeNull();
      expect(result.error).toContain('Must use physical device');
    });

    it('should return token if permissions are granted', async () => {
      (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
      (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({ data: 'ExponentPushToken[12345]' });

      const result = await PushNotificationService.registerForPushNotificationsAsync();
      expect(result.status).toBe('granted');
      expect(result.token).toBe('ExponentPushToken[12345]');
      expect(result.error).toBeNull();
    });

    it('should request permission if undetermined and return token if granted', async () => {
      (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'undetermined' });
      (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
      (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({ data: 'ExponentPushToken[12345]' });

      const result = await PushNotificationService.registerForPushNotificationsAsync();
      expect(Notifications.requestPermissionsAsync).toHaveBeenCalled();
      expect(result.status).toBe('granted');
      expect(result.token).toBe('ExponentPushToken[12345]');
    });

    it('should return error if permissions are denied', async () => {
      (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'undetermined' });
      (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });

      const result = await PushNotificationService.registerForPushNotificationsAsync();
      expect(result.status).toBe('denied');
      expect(result.token).toBeNull();
      expect(result.error).toContain('denied');
    });

    it('should set up notification channel on Android device', async () => {
      // Set platform to Android
      Platform.OS = 'android';
      (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
      (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({ data: 'ExponentPushToken[12345]' });

      await PushNotificationService.registerForPushNotificationsAsync();
      expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith('default', expect.any(Object));

      // Reset platform to iOS
      Platform.OS = 'ios';
    });
  });

  describe('scheduleLocalNotificationAsync', () => {
    it('should schedule notification and return identifier', async () => {
      (Notifications.scheduleNotificationAsync as jest.Mock).mockResolvedValue('mock-id-999');

      const id = await PushNotificationService.scheduleLocalNotificationAsync('Test Title', 'Test Body');
      expect(id).toBe('mock-id-999');
      expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            title: 'Test Title',
            body: 'Test Body',
          }),
        })
      );
    });
  });
});
