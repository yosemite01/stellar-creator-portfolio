/**
 * CheckboxInput — Issue #531
 * "Draft standard Mobile Form Inputs and Accessibility implementations"
 *
 * Features:
 *  - Accessible checkbox with proper state management
 *  - Label with proper association
 *  - Dark mode support
 *  - Custom styling options
 */

import React, { useCallback } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewProps,
} from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { FontSize, FontWeight, Radius, Spacing } from '../../theme/tokens';

interface CheckboxInputProps extends Omit<ViewProps, 'children' | 'onPress'> {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  required?: boolean;
  helpText?: string;
}

export function CheckboxInput({
  label,
  value,
  onValueChange,
  disabled = false,
  required = false,
  helpText,
  style,
  ...props
}: CheckboxInputProps) {
  const { colors } = useTheme();

  const handlePress = useCallback(() => {
    if (!disabled) {
      onValueChange(!value);
    }
  }, [value, onValueChange, disabled]);

  return (
    <View style={[styles.container, style]} {...props}>
      <Pressable
        style={[
          styles.checkboxContainer,
          {
            opacity: disabled ? 0.5 : 1,
          },
        ]}
        onPress={handlePress}
        disabled={disabled}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: value, disabled }}
        accessibilityLabel={label}
        accessibilityHint={helpText}
      >
        <View
          style={[
            styles.checkbox,
            {
              borderColor: value ? colors.primary : colors.border,
              backgroundColor: value ? colors.primary : colors.surface,
              borderWidth: value ? 0 : 1,
            },
          ]}
        >
          {value && (
            <Text
              style={[
                styles.checkmark,
                {
                  color: colors.textInverse,
                },
              ]}
            >
              ✓
            </Text>
          )}
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
            {required && <Text style={[styles.required, { color: colors.error }]}> *</Text>}
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
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.base,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: Radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  checkmark: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.bold,
  },
  labelContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  label: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.medium,
  },
  required: {
    fontSize: FontSize.base,
  },
  helpText: {
    fontSize: FontSize.sm,
    marginTop: Spacing.xs,
  },
});
