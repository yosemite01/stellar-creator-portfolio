/**
 * ToggleInput — Issue #531
 * "Draft standard Mobile Form Inputs and Accessibility implementations"
 *
 * Features:
 *  - Accessible toggle/switch input
 *  - Smooth animations
 *  - Label support
 *  - Dark mode support
 */

import React, { useCallback } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewProps,
} from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { FontSize, FontWeight, Radius, Spacing } from '../../theme/tokens';

interface ToggleInputProps extends Omit<ViewProps, 'children'> {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  helpText?: string;
}

export function ToggleInput({
  label,
  value,
  onValueChange,
  disabled = false,
  helpText,
  style,
  ...props
}: ToggleInputProps) {
  const { colors } = useTheme();

  const handleToggle = useCallback(() => {
    if (!disabled) {
      onValueChange(!value);
    }
  }, [value, onValueChange, disabled]);

  return (
    <View style={[styles.container, style]} {...props}>
      <Pressable
        style={[
          styles.toggleContainer,
          {
            opacity: disabled ? 0.5 : 1,
          },
        ]}
        onPress={handleToggle}
        disabled={disabled}
        accessibilityRole="switch"
        accessibilityState={{ checked: value, disabled }}
        accessibilityLabel={label}
        accessibilityHint={helpText}
      >
        <View
          style={[
            styles.toggleBackground,
            {
              backgroundColor: value ? colors.primary : colors.border,
            },
          ]}
        >
          <Animated.View
            style={[
              styles.toggleThumb,
              {
                backgroundColor: colors.surface,
                transform: [
                  {
                    translateX: value ? 20 : 0,
                  },
                ],
              },
            ]}
          />
        </View>

        <View style={styles.labelContainer}>
          <Text
            style={[
              styles.label,
              {
                color: colors.text,
              },
            ]}
          >
            {label}
          </Text>
          {helpText && (
            <Text
              style={[
                styles.helpText,
                {
                  color: colors.textTertiary,
                },
              ]}
            >
              {helpText}
            </Text>
          )}
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing.base,
  },
  toggleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.base,
    minHeight: 48,
  },
  toggleBackground: {
    width: 50,
    height: 28,
    borderRadius: Radius.full,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  toggleThumb: {
    width: 24,
    height: 24,
    borderRadius: Radius.full,
  },
  labelContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  label: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.medium,
  },
  helpText: {
    fontSize: FontSize.sm,
    marginTop: Spacing.xs,
  },
});
