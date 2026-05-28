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
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { usePreferences } from '../hooks/usePreferences';
import { PreferenceSection } from '../components/PreferenceSection';
import { PreferenceToggle } from '../components/PreferenceToggle';
import { PreferenceSelect } from '../components/PreferenceSelect';
import { PreferenceSlider } from '../components/PreferenceSlider';

export const PreferencesScreen: React.FC = () => {
  const {
    preferences,
    loading,
    error,
    updateSection,
    resetPreferences,
    refreshPreferences,
  } = usePreferences();

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
});
