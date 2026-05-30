/**
 * GlobalHeader — the shared, platform-aware header for authenticated screens.
 *
 * Built entirely from React Native primitives (`View`, `Text`,
 * `TouchableOpacity`, `Platform`) — no third-party UI libraries. It adapts its
 * status-bar-aware top padding per platform, supports light/dark mode via
 * `useColorScheme`, and exposes accessible, typed props.
 */
import React, {
  memo,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import {
  Platform,
  StatusBar,
  Text,
  TouchableOpacity,
  useColorScheme,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { headerPalette, styles } from './GlobalHeader.styles';

/** Props accepted by {@link GlobalHeader}. */
export interface GlobalHeaderProps {
  /** Title text rendered centered in the header. */
  title: string;
  /** Whether to render the leading back button. Defaults to `false`. */
  showBackButton?: boolean;
  /**
   * Custom back handler. When omitted, the back button falls back to
   * `router.back()` from `expo-router`.
   */
  onBackPress?: () => void;
  /** Optional node rendered in the trailing slot (e.g. an action icon). */
  rightAction?: ReactNode;
}

/**
 * Authenticated global header. Memoized so it does not re-render when a parent
 * re-renders without changing its props.
 *
 * @param props - {@link GlobalHeaderProps}
 * @returns The rendered header element.
 */
function GlobalHeaderComponent({
  title,
  showBackButton = false,
  onBackPress,
  rightAction,
}: GlobalHeaderProps): React.JSX.Element {
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const palette = headerPalette[colorScheme === 'dark' ? 'dark' : 'light'];

  // Status-bar-aware top padding: iOS relies on the safe-area inset, Android on
  // the status bar height (falling back to the inset when unavailable).
  const topPadding = Platform.select({
    ios: insets.top,
    android: StatusBar.currentHeight ?? insets.top,
    default: insets.top,
  });

  const handleBackPress = useCallback(() => {
    if (onBackPress) {
      onBackPress();
      return;
    }
    router.back();
  }, [onBackPress]);

  const containerStyle = useMemo(
    () => [
      styles.container,
      {
        backgroundColor: palette.background,
        borderBottomColor: palette.border,
        paddingTop: topPadding,
      },
    ],
    [palette.background, palette.border, topPadding],
  );

  const titleStyle = useMemo(
    () => [styles.title, { color: palette.title }],
    [palette.title],
  );

  const backLabelStyle = useMemo(
    () => [styles.backLabel, { color: palette.icon }],
    [palette.icon],
  );

  return (
    <View style={containerStyle}>
      <View style={styles.row}>
        <View style={styles.sideLeft}>
          {showBackButton ? (
            <TouchableOpacity
              onPress={handleBackPress}
              style={styles.backButton}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Text style={backLabelStyle}>{'\u2039'}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <Text
          style={titleStyle}
          numberOfLines={1}
          accessibilityRole="header"
          accessibilityLabel={title}
        >
          {title}
        </Text>

        <View style={styles.sideRight}>{rightAction}</View>
      </View>
    </View>
  );
}

/** Memoized {@link GlobalHeaderComponent}. */
export const GlobalHeader = memo(GlobalHeaderComponent);
GlobalHeader.displayName = 'GlobalHeader';
