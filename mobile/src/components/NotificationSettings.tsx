/**
 * NotificationSettings Component
 * UI for managing push notification settings and testing
 */

import React, { memo, useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useNotifications } from '../hooks/useNotifications';
import { PreferenceSection } from './PreferenceSection';
import { PreferenceToggle } from './PreferenceToggle';

export const NotificationSettings: React.FC = memo(() => {
  const {
    pushToken,
    permissionStatus,
    lastNotification,
    isRegistering,
    error,
    registerForNotifications,
    requestPermissions,
    sendTestNotification,
    setBadgeCount,
    dismissAllNotifications,
  } = useNotifications();

  const [testingNotification, setTestingNotification] = useState(false);

  const handleRegister = useCallback(async () => {
    const result = await registerForNotifications();
    if (result) {
      Alert.alert(
        'Success',
        `Registered for push notifications!\n\nToken: ${result.token.substring(0, 20)}...`,
        [{ text: 'OK' }]
      );
    } else {
      Alert.alert('Error', 'Failed to register for push notifications');
    }
  }, [registerForNotifications]);

  const handleRequestPermissions = useCallback(async () => {
    const status = await requestPermissions();
    if (status.granted) {
      Alert.alert('Success', 'Notification permissions granted!');
    } else {
      Alert.alert(
        'Permissions Denied',
        'Please enable notifications in your device settings to receive push notifications.'
      );
    }
  }, [requestPermissions]);

  const handleTestNotification = useCallback(async () => {
    setTestingNotification(true);
    try {
      await sendTestNotification();
      Alert.alert('Success', 'Test notification sent!');
    } catch (err) {
      Alert.alert('Error', 'Failed to send test notification');
    } finally {
      setTestingNotification(false);
    }
  }, [sendTestNotification]);

  const handleCopyToken = useCallback(() => {
    if (pushToken) {
      Clipboard.setStringAsync(pushToken);
      Alert.alert('Copied', 'Push token copied to clipboard');
    }
  }, [pushToken]);

  const handleSetBadge = useCallback(async (count: number) => {
    await setBadgeCount(count);
    Alert.alert('Success', `Badge count set to ${count}`);
  }, [setBadgeCount]);

  const handleDismissAll = useCallback(async () => {
    await dismissAllNotifications();
    Alert.alert('Success', 'All notifications dismissed');
  }, [dismissAllNotifications]);

  return (
    <ScrollView style={styles.container}>
      <PreferenceSection
        title="Push Notifications"
        description="Manage push notification settings"
        icon="🔔"
      >
        {/* Permission Status */}
        <View style={styles.statusCard}>
          <Text style={styles.statusLabel}>Permission Status</Text>
          <View style={styles.statusRow}>
            <Text style={styles.statusValue}>
              {permissionStatus?.granted ? '✅ Granted' : '❌ Not Granted'}
            </Text>
            {permissionStatus && !permissionStatus.granted && permissionStatus.canAskAgain && (
              <TouchableOpacity
                style={styles.smallButton}
                onPress={handleRequestPermissions}
              >
                <Text style={styles.smallButtonText}>Request</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* iOS Specific Permissions */}
        {permissionStatus?.ios && (
          <View style={styles.statusCard}>
            <Text style={styles.statusLabel}>iOS Permissions</Text>
            <PreferenceToggle
              label="Alerts"
              value={permissionStatus.ios.allowsAlert}
              onValueChange={() => {}}
              disabled={true}
            />
            <PreferenceToggle
              label="Badge"
              value={permissionStatus.ios.allowsBadge}
              onValueChange={() => {}}
              disabled={true}
            />
            <PreferenceToggle
              label="Sound"
              value={permissionStatus.ios.allowsSound}
              onValueChange={() => {}}
              disabled={true}
            />
          </View>
        )}

        {/* Push Token */}
        {pushToken && (
          <View style={styles.statusCard}>
            <Text style={styles.statusLabel}>Push Token</Text>
            <TouchableOpacity onPress={handleCopyToken}>
              <Text style={styles.tokenText} numberOfLines={2}>
                {pushToken}
              </Text>
              <Text style={styles.copyHint}>Tap to copy</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Last Notification */}
        {lastNotification && (
          <View style={styles.statusCard}>
            <Text style={styles.statusLabel}>Last Notification</Text>
            <Text style={styles.notificationTitle}>
              {lastNotification.request.content.title}
            </Text>
            <Text style={styles.notificationBody}>
              {lastNotification.request.content.body}
            </Text>
          </View>
        )}

        {/* Error Display */}
        {error && (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>⚠️ {error}</Text>
          </View>
        )}

        {/* Action Buttons */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[styles.button, styles.primaryButton]}
            onPress={handleRegister}
            disabled={isRegistering || !!pushToken}
          >
            {isRegistering ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.buttonText}>
                {pushToken ? '✓ Registered' : 'Register for Notifications'}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.button,
              styles.secondaryButton,
              (!permissionStatus?.granted || !pushToken) && styles.disabledButton,
            ]}
            onPress={handleTestNotification}
            disabled={!permissionStatus?.granted || !pushToken || testingNotification}
          >
            {testingNotification ? (
              <ActivityIndicator color="#6366f1" />
            ) : (
              <Text style={styles.secondaryButtonText}>Send Test Notification</Text>
            )}
          </TouchableOpacity>

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.button, styles.smallActionButton]}
              onPress={() => handleSetBadge(5)}
              disabled={!pushToken}
            >
              <Text style={styles.secondaryButtonText}>Set Badge (5)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.smallActionButton]}
              onPress={() => handleSetBadge(0)}
              disabled={!pushToken}
            >
              <Text style={styles.secondaryButtonText}>Clear Badge</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.button, styles.secondaryButton]}
            onPress={handleDismissAll}
            disabled={!pushToken}
          >
            <Text style={styles.secondaryButtonText}>Dismiss All Notifications</Text>
          </TouchableOpacity>
        </View>

        {/* Info Section */}
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>ℹ️ About Push Notifications</Text>
          <Text style={styles.infoText}>
            • Push notifications only work on physical devices{'\n'}
            • You need to grant permissions to receive notifications{'\n'}
            • Test notifications are sent locally{'\n'}
            • Production notifications require a backend server{'\n'}
            • Badge counts are iOS-specific
          </Text>
        </View>
      </PreferenceSection>
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  statusCard: {
    backgroundColor: '#f9fafb',
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
  },
  statusLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6b7280',
    marginBottom: 8,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  tokenText: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#4b5563',
    backgroundColor: '#ffffff',
    padding: 8,
    borderRadius: 4,
    marginTop: 4,
  },
  copyHint: {
    fontSize: 11,
    color: '#9ca3af',
    marginTop: 4,
    textAlign: 'center',
  },
  notificationTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginTop: 4,
  },
  notificationBody: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 4,
  },
  errorCard: {
    backgroundColor: '#fef2f2',
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  errorText: {
    fontSize: 14,
    color: '#dc2626',
  },
  buttonContainer: {
    marginTop: 8,
  },
  button: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    minHeight: 48,
  },
  primaryButton: {
    backgroundColor: '#6366f1',
  },
  secondaryButton: {
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: '#6366f1',
  },
  disabledButton: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6366f1',
  },
  smallButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#6366f1',
    borderRadius: 6,
  },
  smallButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  smallActionButton: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: '#6366f1',
  },
  infoCard: {
    backgroundColor: '#eff6ff',
    padding: 16,
    borderRadius: 8,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#dbeafe',
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1e40af',
    marginBottom: 8,
  },
  infoText: {
    fontSize: 13,
    color: '#1e40af',
    lineHeight: 20,
  },
});
