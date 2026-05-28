/**
 * PreferencesScreen - Main Preferences UI
 * Comprehensive native preferences interface with optimized rendering
 */

import React, { useCallback, useMemo } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Text,
  TouchableOpacity,
  Clipboard,
  Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { usePreferences } from '../hooks/usePreferences';
import { PreferenceSection } from '../components/PreferenceSection';
import { PreferenceToggle } from '../components/PreferenceToggle';
import { PreferenceSelect } from '../components/PreferenceSelect';
import { PreferenceSlider } from '../components/PreferenceSlider';
import { PreferenceCard } from '../components/PreferenceCard';
import { usePushNotifications } from '../hooks/usePushNotifications';

export const PreferencesScreen: React.FC = () => {
  const {
    preferences,
    loading,
    error,
    updateSection,
    resetPreferences,
    refreshPreferences,
  } = usePreferences();

  const {
    expoPushToken,
    permissionStatus,
    isDevice,
    notificationsHistory,
    isRegistering,
    error: pushError,
    registerForPushNotifications,
    sendTestLocalNotification,
    simulateRemoteNotification,
    clearHistory,
  } = usePushNotifications();

  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshPreferences();
    setRefreshing(false);
  }, [refreshPreferences]);

  const handleResetPreferences = useCallback(() => {
    Alert.alert(
      'Reset Preferences',
      'Are you sure you want to reset all preferences to default values?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            const success = await resetPreferences();
            if (success) {
              Alert.alert('Success', 'Preferences have been reset to defaults');
            } else {
              Alert.alert('Error', 'Failed to reset preferences');
            }
          },
        },
      ]
    );
  }, [resetPreferences]);

  // Theme options
  const themeOptions = useMemo(() => [
    { label: 'Light', value: 'light' },
    { label: 'Dark', value: 'dark' },
    { label: 'Auto (System)', value: 'auto' },
  ], []);

  // Font size options
  const fontSizeOptions = useMemo(() => [
    { label: 'Small', value: 'small' },
    { label: 'Medium', value: 'medium' },
    { label: 'Large', value: 'large' },
    { label: 'Extra Large', value: 'extra-large' },
  ], []);

  // View options
  const viewOptions = useMemo(() => [
    { label: 'Grid', value: 'grid' },
    { label: 'List', value: 'list' },
    { label: 'Masonry', value: 'masonry' },
  ], []);

  // Data usage options
  const dataUsageOptions = useMemo(() => [
    { label: 'Low', value: 'low' },
    { label: 'Medium', value: 'medium' },
    { label: 'High', value: 'high' },
  ], []);

  // Profile visibility options
  const visibilityOptions = useMemo(() => [
    { label: 'Public', value: 'public' },
    { label: 'Private', value: 'private' },
    { label: 'Connections Only', value: 'connections-only' },
  ], []);

  // Time format options
  const timeFormatOptions = useMemo(() => [
    { label: '12 Hour', value: '12h' },
    { label: '24 Hour', value: '24h' },
  ], []);

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#6366f1" />
        <Text style={styles.loadingText}>Loading preferences...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>⚠️ {error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={onRefresh}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="auto" />
      
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Preferences</Text>
        <TouchableOpacity onPress={handleResetPreferences}>
          <Text style={styles.resetButton}>Reset All</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Display Preferences */}
        <PreferenceSection
          title="Display"
          description="Customize the appearance of the app"
          icon="🎨"
        >
          <PreferenceSelect
            label="Theme"
            description="Choose your preferred color theme"
            value={preferences.display.theme}
            options={themeOptions}
            onValueChange={(value) => updateSection('display', { theme: value })}
          />
          <PreferenceSelect
            label="Font Size"
            description="Adjust text size for better readability"
            value={preferences.display.fontSize}
            options={fontSizeOptions}
            onValueChange={(value) => updateSection('display', { fontSize: value })}
          />
          <PreferenceToggle
            label="High Contrast"
            description="Increase contrast for better visibility"
            value={preferences.display.highContrast}
            onValueChange={(value) => updateSection('display', { highContrast: value })}
          />
          <PreferenceToggle
            label="Reduced Motion"
            description="Minimize animations and transitions"
            value={preferences.display.reducedMotion}
            onValueChange={(value) => updateSection('display', { reducedMotion: value })}
          />
        </PreferenceSection>

        {/* Notification Preferences */}
        <PreferenceSection
          title="Notifications"
          description="Manage how you receive updates"
          icon="🔔"
        >
          <PreferenceToggle
            label="Enable Notifications"
            description="Receive notifications from the app"
            value={preferences.notifications.enabled}
            onValueChange={(value) => updateSection('notifications', { enabled: value })}
          />
          <PreferenceToggle
            label="Push Notifications"
            description="Receive push notifications on your device"
            value={preferences.notifications.pushEnabled}
            onValueChange={(value) => updateSection('notifications', { pushEnabled: value })}
            disabled={!preferences.notifications.enabled}
          />
          <PreferenceToggle
            label="Email Notifications"
            description="Receive notifications via email"
            value={preferences.notifications.emailEnabled}
            onValueChange={(value) => updateSection('notifications', { emailEnabled: value })}
            disabled={!preferences.notifications.enabled}
          />
          <PreferenceToggle
            label="Project Updates"
            description="Get notified about project changes"
            value={preferences.notifications.projectUpdates}
            onValueChange={(value) => updateSection('notifications', { projectUpdates: value })}
            disabled={!preferences.notifications.enabled}
          />
          <PreferenceToggle
            label="Portfolio Views"
            description="Get notified when someone views your portfolio"
            value={preferences.notifications.portfolioViews}
            onValueChange={(value) => updateSection('notifications', { portfolioViews: value })}
            disabled={!preferences.notifications.enabled}
          />
          <PreferenceToggle
            label="Sound"
            description="Play sound for notifications"
            value={preferences.notifications.soundEnabled}
            onValueChange={(value) => updateSection('notifications', { soundEnabled: value })}
            disabled={!preferences.notifications.enabled}
          />
          <PreferenceToggle
            label="Vibration"
            description="Vibrate for notifications"
            value={preferences.notifications.vibrationEnabled}
            onValueChange={(value) => updateSection('notifications', { vibrationEnabled: value })}
            disabled={!preferences.notifications.enabled}
          />
        </PreferenceSection>

        {/* Privacy Preferences */}
        <PreferenceSection
          title="Privacy"
          description="Control your privacy settings"
          icon="🔒"
        >
          <PreferenceSelect
            label="Profile Visibility"
            description="Who can see your profile"
            value={preferences.privacy.profileVisibility}
            options={visibilityOptions}
            onValueChange={(value) => updateSection('privacy', { profileVisibility: value })}
          />
          <PreferenceToggle
            label="Show Email"
            description="Display email on your profile"
            value={preferences.privacy.showEmail}
            onValueChange={(value) => updateSection('privacy', { showEmail: value })}
          />
          <PreferenceToggle
            label="Show Phone"
            description="Display phone number on your profile"
            value={preferences.privacy.showPhone}
            onValueChange={(value) => updateSection('privacy', { showPhone: value })}
          />
          <PreferenceToggle
            label="Show Location"
            description="Display location on your profile"
            value={preferences.privacy.showLocation}
            onValueChange={(value) => updateSection('privacy', { showLocation: value })}
          />
          <PreferenceToggle
            label="Analytics"
            description="Help improve the app with usage data"
            value={preferences.privacy.analyticsEnabled}
            onValueChange={(value) => updateSection('privacy', { analyticsEnabled: value })}
          />
        </PreferenceSection>

        {/* Content Preferences */}
        <PreferenceSection
          title="Content"
          description="Customize content display"
          icon="📱"
        >
          <PreferenceSelect
            label="Default View"
            description="Choose how content is displayed"
            value={preferences.content.defaultView}
            options={viewOptions}
            onValueChange={(value) => updateSection('content', { defaultView: value })}
          />
          <PreferenceSlider
            label="Items Per Page"
            description="Number of items to display per page"
            value={preferences.content.itemsPerPage}
            min={10}
            max={50}
            step={5}
            onValueChange={(value) => updateSection('content', { itemsPerPage: value })}
          />
          <PreferenceToggle
            label="Auto-play Videos"
            description="Automatically play videos when scrolling"
            value={preferences.content.autoPlayVideos}
            onValueChange={(value) => updateSection('content', { autoPlayVideos: value })}
          />
          <PreferenceToggle
            label="Show Thumbnails"
            description="Display thumbnail previews"
            value={preferences.content.showThumbnails}
            onValueChange={(value) => updateSection('content', { showThumbnails: value })}
          />
          <PreferenceToggle
            label="Cache Images"
            description="Store images locally for faster loading"
            value={preferences.content.cacheImages}
            onValueChange={(value) => updateSection('content', { cacheImages: value })}
          />
          <PreferenceSelect
            label="Data Usage Mode"
            description="Control data consumption"
            value={preferences.content.dataUsageMode}
            options={dataUsageOptions}
            onValueChange={(value) => updateSection('content', { dataUsageMode: value })}
          />
        </PreferenceSection>

        {/* Localization Preferences */}
        <PreferenceSection
          title="Language & Region"
          description="Set your language and regional preferences"
          icon="🌍"
        >
          <PreferenceSelect
            label="Time Format"
            description="Choose 12-hour or 24-hour format"
            value={preferences.localization.timeFormat}
            options={timeFormatOptions}
            onValueChange={(value) => updateSection('localization', { timeFormat: value })}
          />
        </PreferenceSection>

        {/* Accessibility Preferences */}
        <PreferenceSection
          title="Accessibility"
          description="Make the app more accessible"
          icon="♿"
        >
          <PreferenceToggle
            label="Screen Reader"
            description="Enable screen reader support"
            value={preferences.accessibility.screenReader}
            onValueChange={(value) => updateSection('accessibility', { screenReader: value })}
          />
          <PreferenceToggle
            label="Large Text"
            description="Use larger text throughout the app"
            value={preferences.accessibility.largeText}
            onValueChange={(value) => updateSection('accessibility', { largeText: value })}
          />
          <PreferenceToggle
            label="Bold Text"
            description="Make text bold for better readability"
            value={preferences.accessibility.boldText}
            onValueChange={(value) => updateSection('accessibility', { boldText: value })}
          />
          <PreferenceToggle
            label="Button Shapes"
            description="Show shapes around buttons"
            value={preferences.accessibility.buttonShapes}
            onValueChange={(value) => updateSection('accessibility', { buttonShapes: value })}
          />
          <PreferenceToggle
            label="Increase Contrast"
            description="Enhance contrast for better visibility"
            value={preferences.accessibility.increaseContrast}
            onValueChange={(value) => updateSection('accessibility', { increaseContrast: value })}
          />
        </PreferenceSection>

        {/* Performance Preferences */}
        <PreferenceSection
          title="Performance"
          description="Optimize app performance"
          icon="⚡"
        >
          <PreferenceToggle
            label="Enable Animations"
            description="Show smooth animations"
            value={preferences.performance.enableAnimations}
            onValueChange={(value) => updateSection('performance', { enableAnimations: value })}
          />
          <PreferenceToggle
            label="Enable Transitions"
            description="Show page transitions"
            value={preferences.performance.enableTransitions}
            onValueChange={(value) => updateSection('performance', { enableTransitions: value })}
          />
          <PreferenceToggle
            label="Hardware Acceleration"
            description="Use GPU for better performance"
            value={preferences.performance.hardwareAcceleration}
            onValueChange={(value) => updateSection('performance', { hardwareAcceleration: value })}
          />
          <PreferenceToggle
            label="Prefetch Content"
            description="Load content in advance"
            value={preferences.performance.prefetchContent}
            onValueChange={(value) => updateSection('performance', { prefetchContent: value })}
          />
          <PreferenceToggle
            label="Background Sync"
            description="Sync data in the background"
            value={preferences.performance.backgroundSync}
            onValueChange={(value) => updateSection('performance', { backgroundSync: value })}
          />
        </PreferenceSection>

        {/* Push Notification Integration */}
        <PreferenceSection
          title="Push Notification Center"
          description="Natively manage and test secure Expo push notification workflows"
          icon="📲"
        >
          {/* Main Controls Card */}
          <PreferenceCard
            title="Expo Registration Status"
            subtitle={isDevice ? "Physical device mode" : "Simulator mode (using local notifications fallback)"}
          >
            {!isDevice && (
              <View style={styles.warningBanner}>
                <Text style={styles.warningText}>
                  ⚠️ Simulator environment: Push tokens require a physical device. Foreground and local scheduling tests remain functional.
                </Text>
              </View>
            )}

            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>Permission Status:</Text>
              <View style={[
                styles.statusBadge,
                permissionStatus === 'granted' ? styles.badgeGranted :
                permissionStatus === 'denied' ? styles.badgeDenied : styles.badgeUndetermined
              ]}>
                <Text style={styles.badgeText}>
                  {permissionStatus.toUpperCase()}
                </Text>
              </View>
            </View>

            <View style={styles.tokenSection}>
              <Text style={styles.statusLabel}>Expo Push Token:</Text>
              {expoPushToken ? (
                <View style={styles.tokenContainer}>
                  <Text style={styles.tokenText} numberOfLines={1} ellipsizeMode="middle">
                    {expoPushToken}
                  </Text>
                  <TouchableOpacity
                    style={styles.copyButton}
                    onPress={() => {
                      Clipboard.setString(expoPushToken);
                      Alert.alert('Copied!', 'Expo Push Token has been copied to your clipboard.');
                    }}
                  >
                    <Text style={styles.copyButtonText}>Copy</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <Text style={styles.noTokenText}>
                  {pushError ? `Error: ${pushError}` : 'No token generated. Register below to fetch.'}
                </Text>
              )}
            </View>

            <View style={styles.actionsContainer}>
              <TouchableOpacity
                style={[styles.primaryButton, isRegistering && styles.disabledButton]}
                onPress={registerForPushNotifications}
                disabled={isRegistering}
              >
                {isRegistering ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.primaryButtonText}>Register Device & Fetch Token</Text>
                )}
              </TouchableOpacity>
            </View>

            <View style={styles.testButtonsContainer}>
              <TouchableOpacity
                style={[styles.secondaryButton, permissionStatus !== 'granted' && styles.disabledButton]}
                onPress={() => sendTestLocalNotification()}
                disabled={permissionStatus !== 'granted'}
              >
                <Text style={styles.secondaryButtonText}>Local Test Alert</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => simulateRemoteNotification()}
              >
                <Text style={styles.secondaryButtonText}>Simulate Remote Push</Text>
              </TouchableOpacity>
            </View>
          </PreferenceCard>

          {/* Activity Logs Card */}
          <PreferenceCard
            title="Notification Activity Log"
            subtitle="Logs of foreground and simulated notifications"
          >
            <View style={styles.logsHeader}>
              <Text style={styles.logsCount}>
                {notificationsHistory.length} Event(s) logged
              </Text>
              {notificationsHistory.length > 0 && (
                <TouchableOpacity onPress={clearHistory}>
                  <Text style={styles.clearLogsText}>Clear Log</Text>
                </TouchableOpacity>
              )}
            </View>

            {notificationsHistory.length === 0 ? (
              <Text style={styles.emptyLogsText}>
                No notification activity recorded yet.
              </Text>
            ) : (
              <View style={styles.logsList}>
                {notificationsHistory.map((log) => (
                  <View key={log.id} style={styles.logCard}>
                    <View style={styles.logMeta}>
                      <View style={[
                        styles.logTypeBadge,
                        log.type === 'push' ? styles.logTypePush :
                        log.type === 'local' ? styles.logTypeLocal : styles.logTypeSimulated
                      ]}>
                        <Text style={styles.logTypeText}>{log.type.toUpperCase()}</Text>
                      </View>
                      <Text style={styles.logTime}>
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </Text>
                    </View>
                    <Text style={styles.logTitle}>{log.title}</Text>
                    <Text style={styles.logBody}>{log.body}</Text>
                    {Object.keys(log.data).length > 0 && (
                      <Text style={styles.logData}>
                        Data: {JSON.stringify(log.data, null, 2)}
                      </Text>
                    )}
                  </View>
                ))}
              </View>
            )}
          </PreferenceCard>
        </PreferenceSection>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Preferences are saved automatically
          </Text>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    paddingTop: 60,
    backgroundColor: '#ffffff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#111827',
  },
  resetButton: {
    fontSize: 16,
    color: '#ef4444',
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingVertical: 16,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#6b7280',
  },
  errorText: {
    fontSize: 16,
    color: '#ef4444',
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  retryButton: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#6366f1',
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  footer: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 13,
    color: '#9ca3af',
  },
  warningBanner: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fef3c7',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  warningText: {
    color: '#b45309',
    fontSize: 13,
    lineHeight: 18,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  statusLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4b5563',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 9999,
  },
  badgeGranted: {
    backgroundColor: '#d1fae5',
  },
  badgeDenied: {
    backgroundColor: '#fee2e2',
  },
  badgeUndetermined: {
    backgroundColor: '#e5e7eb',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1f2937',
  },
  tokenSection: {
    marginBottom: 16,
  },
  tokenContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    paddingLeft: 12,
    paddingRight: 4,
    paddingVertical: 4,
    marginTop: 8,
  },
  tokenText: {
    flex: 1,
    fontSize: 12,
    color: '#374151',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  copyButton: {
    backgroundColor: '#6366f1',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  copyButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  noTokenText: {
    fontSize: 13,
    color: '#9ca3af',
    fontStyle: 'italic',
    marginTop: 4,
  },
  actionsContainer: {
    marginBottom: 12,
  },
  primaryButton: {
    backgroundColor: '#6366f1',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  disabledButton: {
    opacity: 0.6,
  },
  testButtonsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  secondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  secondaryButtonText: {
    color: '#4b5563',
    fontSize: 12,
    fontWeight: '600',
  },
  logsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    marginTop: 8,
  },
  logsCount: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4b5563',
  },
  clearLogsText: {
    fontSize: 13,
    color: '#ef4444',
    fontWeight: '600',
  },
  emptyLogsText: {
    fontSize: 13,
    color: '#9ca3af',
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 20,
  },
  logsList: {
    marginTop: 4,
  },
  logCard: {
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  logMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  logTypeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  logTypePush: {
    backgroundColor: '#dbeafe',
  },
  logTypeLocal: {
    backgroundColor: '#e0f2fe',
  },
  logTypeSimulated: {
    backgroundColor: '#f3e8ff',
  },
  logTypeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#374151',
  },
  logTime: {
    fontSize: 11,
    color: '#9ca3af',
  },
  logTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 2,
  },
  logBody: {
    fontSize: 13,
    color: '#4b5563',
    lineHeight: 18,
  },
  logData: {
    fontSize: 11,
    color: '#4b5563',
    backgroundColor: '#f3f4f6',
    padding: 6,
    borderRadius: 4,
    marginTop: 6,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
});
