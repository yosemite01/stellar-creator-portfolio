/**
 * AppIconSettingsScreen — Issue #825
 * Lets users manually pick an alternate app icon and toggle auto-switching.
 * Works on iOS only; shows an informative stub on Android.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import type { AppIconName } from '../services/AppIconService';
import {
  autoSetIconForTheme,
  getCurrentAppIconAsync,
  setAppIconAsync,
  supportsAppIconChangeAsync,
} from '../services/AppIconService';

// ─── Icon catalogue ───────────────────────────────────────────────────────────

interface IconOption {
  name: AppIconName;
  label: string;
  color: string;
  description: string;
}

const ICON_OPTIONS: IconOption[] = [
  { name: 'default',   label: 'Default',   color: '#4F8EF7', description: 'The original Stellar icon' },
  { name: 'aurora',    label: 'Aurora',    color: '#A78BFA', description: 'Vibrant aurora gradients' },
  { name: 'midnight',  label: 'Midnight',  color: '#1E3A5F', description: 'Deep blue night sky' },
  { name: 'forest',    label: 'Forest',    color: '#22C55E', description: 'Fresh green tones' },
  { name: 'dark',      label: 'Dark',      color: '#0F172A', description: 'Sleek monochrome dark' },
  { name: 'halloween', label: 'Halloween', color: '#F97316', description: 'Spooky seasonal theme 🎃' },
];

// ─── Component ────────────────────────────────────────────────────────────────

interface AppIconSettingsScreenProps {
  onBack?: () => void;
}

export function AppIconSettingsScreen({ onBack }: AppIconSettingsScreenProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const [supported, setSupported] = useState<boolean | null>(null);
  const [activeIcon, setActiveIcon] = useState<AppIconName>('default');
  const [autoFollow, setAutoFollow] = useState(false);
  const [loading, setLoading] = useState<AppIconName | null>(null);

  // Detect support and current icon on mount
  useEffect(() => {
    (async () => {
      const [supportsChange, current] = await Promise.all([
        supportsAppIconChangeAsync(),
        getCurrentAppIconAsync(),
      ]);
      setSupported(supportsChange);
      setActiveIcon(current);
    })();
  }, []);

  // When auto-follow is toggled on, immediately sync to current color scheme
  useEffect(() => {
    if (autoFollow && colorScheme) {
      autoSetIconForTheme(colorScheme).then(() =>
        getCurrentAppIconAsync().then(setActiveIcon),
      );
    }
  }, [autoFollow, colorScheme]);

  const handleSelect = useCallback(
    async (icon: AppIconName) => {
      if (!supported || loading) return;
      setLoading(icon);
      try {
        await setAppIconAsync(icon);
        setActiveIcon(icon);
        setAutoFollow(false); // manual pick overrides auto
      } finally {
        setLoading(null);
      }
    },
    [supported, loading],
  );

  // Theme-aware colours
  const bg     = isDark ? '#0F172A' : '#F8FAFC';
  const card   = isDark ? '#1E293B' : '#FFFFFF';
  const text   = isDark ? '#F1F5F9' : '#0F172A';
  const sub    = isDark ? '#94A3B8' : '#64748B';
  const border = isDark ? '#334155' : '#E2E8F0';
  const accent = '#6366F1';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: border }]}>
        {onBack && (
          <Pressable
            onPress={onBack}
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Text style={[styles.backText, { color: accent }]}>‹ Back</Text>
          </Pressable>
        )}
        <Text style={[styles.title, { color: text }]}>App Icon</Text>
        <Text style={[styles.subtitle, { color: sub }]}>Choose your app icon</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Unsupported notice */}
        {supported === false && (
          <View style={[styles.notice, { backgroundColor: card, borderColor: border }]}>
            <Text style={[styles.noticeText, { color: sub }]}>
              ⚠️  Dynamic icons are not supported on this device.
              {'\n'}iOS 10.3+ on a physical device is required.
            </Text>
          </View>
        )}

        {/* Auto-follow system theme */}
        <View style={[styles.row, { backgroundColor: card, borderColor: border }]}>
          <View style={styles.rowContent}>
            <Text style={[styles.rowLabel, { color: text }]}>Auto (follows system theme)</Text>
            <Text style={[styles.rowSub, { color: sub }]}>
              Switches to the Dark icon when dark mode is active
            </Text>
          </View>
          <Switch
            value={autoFollow}
            onValueChange={setAutoFollow}
            disabled={!supported}
            trackColor={{ false: '#CBD5E1', true: accent }}
            thumbColor="#FFFFFF"
            accessibilityLabel="Auto icon follows system theme"
          />
        </View>

        {/* Section label */}
        <Text style={[styles.sectionLabel, { color: sub }]}>ICON</Text>

        {/* Icon options */}
        {ICON_OPTIONS.map((option) => {
          const isActive  = activeIcon === option.name;
          const isLoading = loading === option.name;

          return (
            <Pressable
              key={option.name}
              onPress={() => handleSelect(option.name)}
              disabled={!supported || !!loading}
              accessibilityRole="radio"
              accessibilityState={{ checked: isActive }}
              accessibilityLabel={`${option.label}: ${option.description}`}
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: card,
                  borderColor: isActive ? accent : border,
                  borderWidth: isActive ? 2 : 1,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              {/* Colour swatch */}
              <View style={[styles.swatch, { backgroundColor: option.color }]} />

              {/* Label */}
              <View style={styles.rowContent}>
                <Text style={[styles.rowLabel, { color: isActive ? accent : text }]}>
                  {option.label}
                </Text>
                <Text style={[styles.rowSub, { color: sub }]}>{option.description}</Text>
              </View>

              {/* Indicator */}
              {isLoading ? (
                <ActivityIndicator size="small" color={accent} />
              ) : isActive ? (
                <View style={[styles.checkCircle, { backgroundColor: accent }]}>
                  <Text style={styles.checkText}>✓</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}

        {/* Android note */}
        <View style={[styles.notice, { backgroundColor: card, borderColor: border, marginTop: 8 }]}>
          <Text style={[styles.noticeText, { color: sub }]}>
            ℹ️  Android support requires a native module (e.g. react-native-change-icon).
            Place alternate icons in{' '}
            <Text style={{ fontFamily: 'monospace' }}>
              android/app/src/main/res/mipmap-*/
            </Text>{' '}
            and register activity-aliases in AndroidManifest.xml.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1 },

  header: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  backBtn:  { marginBottom: 4 },
  backText: { fontSize: 16, fontWeight: '500' },
  title:    { fontSize: 24, fontWeight: '700' },
  subtitle: { fontSize: 14 },

  scroll: { padding: 16, gap: 10, paddingBottom: 48 },

  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginTop: 4,
    marginBottom: 2,
    paddingHorizontal: 4,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 12,
  },
  rowContent: { flex: 1 },
  rowLabel:   { fontSize: 15, fontWeight: '500' },
  rowSub:     { fontSize: 12, marginTop: 2 },

  swatch: { width: 40, height: 40, borderRadius: 10, flexShrink: 0 },

  checkCircle: {
    width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  checkText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  notice: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  noticeText: { fontSize: 13, lineHeight: 19 },
});
