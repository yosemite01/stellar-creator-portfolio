/**
 * StatusBadge — Issue #532
 * "Develop independent Native Profile Avatar and Status Badges"
 *
 * Features:
 *  - Display various status types (premium, verified, expert, top-rated, etc.)
 *  - Multiple badge styles and colors
 *  - Icon support
 *  - Accessibility support
 *  - Dark mode support
 */

import React, { useMemo } from 'react';
import {
  StyleSheet,
  Text,
  TextProps,
  View,
  ViewProps,
} from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { FontSize, FontWeight, Radius, Spacing } from '../../theme/tokens';

export type BadgeType = 'premium' | 'verified' | 'expert' | 'top-rated' | 'new' | 'featured' | 'online';

interface StatusBadgeProps extends Omit<ViewProps, 'children'> {
  type: BadgeType;
  label?: string;
  size?: 'sm' | 'base' | 'lg';
  variant?: 'solid' | 'outlined';
  icon?: string;
}

const BADGE_CONFIG: Record<BadgeType, { bg: string; fg: string; label: string; emoji: string }> = {
  premium: {
    bg: '#fbbf24',
    fg: '#1f2937',
    label: 'Premium',
    emoji: '👑',
  },
  verified: {
    bg: '#10b981',
    fg: '#ffffff',
    label: 'Verified',
    emoji: '✓',
  },
  expert: {
    bg: '#8b5cf6',
    fg: '#ffffff',
    label: 'Expert',
    emoji: '⭐',
  },
  'top-rated': {
    bg: '#ef4444',
    fg: '#ffffff',
    label: 'Top Rated',
    emoji: '🏆',
  },
  new: {
    bg: '#3b82f6',
    fg: '#ffffff',
    label: 'New',
    emoji: '✨',
  },
  featured: {
    bg: '#ec4899',
    fg: '#ffffff',
    label: 'Featured',
    emoji: '🌟',
  },
  online: {
    bg: '#10b981',
    fg: '#ffffff',
    label: 'Online',
    emoji: '●',
  },
};

const SIZE_MAP = {
  sm: {
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
    fontSize: FontSize.xs,
  },
  base: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    fontSize: FontSize.sm,
  },
  lg: {
    paddingHorizontal: Spacing.base,
    paddingVertical: 6,
    fontSize: FontSize.base,
  },
};

export function StatusBadge({
  type,
  label,
  size = 'base',
  variant = 'solid',
  icon,
  style,
  ...props
}: StatusBadgeProps) {
  const { colors } = useTheme();
  const config = BADGE_CONFIG[type];
  const sizeConfig = SIZE_MAP[size];

  const badgeColors = useMemo(() => {
    if (variant === 'outlined') {
      return {
        bg: colors.surface,
        fg: config.bg,
        borderColor: config.bg,
        borderWidth: 1,
      };
    }
    return {
      bg: config.bg,
      fg: config.fg,
      borderColor: undefined,
      borderWidth: 0,
    };
  }, [variant, config, colors]);

  const displayLabel = label || config.label;
  const displayEmoji = icon || config.emoji;

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: badgeColors.bg,
          borderColor: badgeColors.borderColor,
          borderWidth: badgeColors.borderWidth,
          paddingHorizontal: sizeConfig.paddingHorizontal,
          paddingVertical: sizeConfig.paddingVertical,
        },
        style,
      ]}
      accessibilityLabel={`${displayLabel} badge`}
      accessibilityRole="image"
      {...props}
    >
      <Text
        style={[
          styles.emoji,
          {
            color: badgeColors.fg,
            fontSize: sizeConfig.fontSize,
            marginRight: Spacing.xs / 2,
          },
        ]}
        allowFontScaling={false}
      >
        {displayEmoji}
      </Text>
      <Text
        style={[
          styles.label,
          {
            color: badgeColors.fg,
            fontSize: sizeConfig.fontSize,
            fontWeight: FontWeight.semibold,
          },
        ]}
        allowFontScaling={false}
      >
        {displayLabel}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
  },
  emoji: {
    marginRight: 4,
  },
  label: {
    textAlign: 'center',
  },
});
