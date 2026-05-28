/**
 * Avatar — Issue #532
 * "Develop independent Native Profile Avatar and Status Badges"
 *
 * Features:
 *  - Display user profile picture with fallback to initials
 *  - Multiple sizes (xs, sm, base, lg, xl)
 *  - Support for online/offline status indicator
 *  - Border styling options
 *  - Accessibility support
 *  - Dark mode support
 */

import React, { useMemo } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  View,
  ViewProps,
} from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { FontSize, FontWeight, Radius, Spacing } from '../../theme/tokens';

interface AvatarProps extends Omit<ViewProps, 'children'> {
  source?: { uri: string } | number;
  initials?: string;
  size?: 'xs' | 'sm' | 'base' | 'lg' | 'xl';
  borderColor?: string;
  borderWidth?: number;
  onlineStatus?: 'online' | 'offline' | 'idle';
  showStatusIndicator?: boolean;
  accessibilityLabel?: string;
}

const SIZE_MAP = {
  xs: 32,
  sm: 40,
  base: 56,
  lg: 80,
  xl: 120,
};

const INDICATOR_SIZE_MAP = {
  xs: 8,
  sm: 10,
  base: 14,
  lg: 20,
  xl: 28,
};

const INITIALS_SIZE_MAP = {
  xs: FontSize.xs,
  sm: FontSize.sm,
  base: FontSize.base,
  lg: FontSize.lg,
  xl: FontSize.xl,
};

export function Avatar({
  source,
  initials = '?',
  size = 'base',
  borderColor,
  borderWidth = 0,
  onlineStatus,
  showStatusIndicator = true,
  accessibilityLabel,
  style,
  ...props
}: AvatarProps) {
  const { colors } = useTheme();
  const sizeValue = SIZE_MAP[size];
  const indicatorSizeValue = INDICATOR_SIZE_MAP[size];
  const initialsFontSize = INITIALS_SIZE_MAP[size];

  // Determine status indicator color
  const statusColor = useMemo(() => {
    switch (onlineStatus) {
      case 'online':
        return '#10b981';
      case 'idle':
        return '#f59e0b';
      case 'offline':
      default:
        return '#6b7280';
    }
  }, [onlineStatus]);

  return (
    <View
      style={[
        styles.container,
        {
          width: sizeValue,
          height: sizeValue,
          borderRadius: sizeValue / 2,
          borderColor: borderColor || colors.border,
          borderWidth,
        },
        style,
      ]}
      accessibilityLabel={accessibilityLabel || `Avatar for ${initials}`}
      {...props}
    >
      {source ? (
        <Image
          source={source}
          style={[
            styles.image,
            {
              width: sizeValue - borderWidth * 2,
              height: sizeValue - borderWidth * 2,
              borderRadius: (sizeValue - borderWidth * 2) / 2,
            },
          ]}
          accessibilityRole="image"
        />
      ) : (
        <View
          style={[
            styles.initialsContainer,
            {
              backgroundColor: colors.primary,
              width: sizeValue - borderWidth * 2,
              height: sizeValue - borderWidth * 2,
              borderRadius: (sizeValue - borderWidth * 2) / 2,
            },
          ]}
        >
          <Text
            style={[
              styles.initials,
              {
                fontSize: initialsFontSize,
                color: colors.textInverse,
              },
            ]}
            accessibilityRole="text"
            allowFontScaling={false}
          >
            {initials}
          </Text>
        </View>
      )}

      {showStatusIndicator && onlineStatus && (
        <View
          style={[
            styles.statusIndicator,
            {
              width: indicatorSizeValue,
              height: indicatorSizeValue,
              borderRadius: indicatorSizeValue / 2,
              backgroundColor: statusColor,
              borderColor: colors.background,
              right: 0,
              bottom: 0,
            },
          ]}
          accessibilityLabel={`Status: ${onlineStatus}`}
          accessibilityRole="status"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    overflow: 'hidden',
  },
  initialsContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  initials: {
    fontWeight: FontWeight.bold,
    textAlign: 'center',
  },
  statusIndicator: {
    position: 'absolute',
    borderWidth: 2,
  },
});
