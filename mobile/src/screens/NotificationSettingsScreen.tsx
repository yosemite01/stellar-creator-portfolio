import React, { useCallback } from 'react';
import {
  Linking,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { FontSize, FontWeight, Radius, Spacing } from '../theme/tokens';
import { useUIStore } from '../store/uiStore';

interface NotificationSettingsScreenProps {
  onBack?: () => void;
}

export function NotificationSettingsScreen({ onBack }: NotificationSettingsScreenProps) {
  const { colors } = useTheme();
  const notificationPermission = useUIStore((s) => s.notificationPermission);

  const openOSSettings = useCallback(() => {
    Linking.openSettings();
  }, []);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        {onBack && (
          <Pressable onPress={onBack} style={styles.backButton} accessibilityRole="button">
            <Text style={[styles.backText, { color: colors.primary }]}>← Back</Text>
          </Pressable>
        )}
        <Text style={[styles.title, { color: colors.text }]}>Notifications</Text>
      </View>

      <View style={styles.content}>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={styles.cardIcon}>🔔</Text>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Push Notifications</Text>

          {notificationPermission === 'granted' && (
            <Text style={[styles.statusText, { color: colors.success ?? '#10b981' }]}>
              Notifications are enabled
            </Text>
          )}

          {notificationPermission === 'denied' && (
            <>
              <Text style={[styles.statusText, { color: colors.error }]}>
                Notifications are disabled
              </Text>
              <Text style={[styles.description, { color: colors.textSecondary }]}>
                To receive alerts for bounty applications and messages, enable notifications in your device settings.
              </Text>
              <Pressable
                style={[styles.button, { backgroundColor: colors.primary }]}
                onPress={openOSSettings}
                accessibilityRole="button"
              >
                <Text style={styles.buttonText}>Open Device Settings</Text>
              </Pressable>
            </>
          )}

          {notificationPermission === 'undetermined' && (
            <Text style={[styles.description, { color: colors.textSecondary }]}>
              Notification permission has not been requested yet. Complete the onboarding to set up notifications.
            </Text>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.base,
  },
  backButton: { marginBottom: Spacing.sm },
  backText: { fontSize: FontSize.base, fontWeight: FontWeight.medium },
  title: { fontSize: FontSize['2xl'], fontWeight: FontWeight.bold },
  content: { flex: 1, paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg },
  card: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.sm,
  },
  cardIcon: { fontSize: 48 },
  cardTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  statusText: { fontSize: FontSize.base, fontWeight: FontWeight.medium },
  description: { fontSize: FontSize.sm, textAlign: 'center', lineHeight: 22 },
  button: {
    marginTop: Spacing.base,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    borderRadius: Radius.xl,
  },
  buttonText: { color: '#ffffff', fontSize: FontSize.base, fontWeight: FontWeight.semibold },
});
