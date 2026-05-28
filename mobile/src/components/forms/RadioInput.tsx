/**
 * RadioInput — Issue #531
 * "Draft standard Mobile Form Inputs and Accessibility implementations"
 *
 * Features:
 *  - Accessible radio button with proper state management
 *  - Label with proper association
 *  - Dark mode support
 *  - Support for radio groups
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

interface RadioOption<T> {
  label: string;
  value: T;
  disabled?: boolean;
}

interface RadioInputProps<T> extends Omit<ViewProps, 'children' | 'onPress'> {
  options: RadioOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  disabled?: boolean;
  groupLabel?: string;
  direction?: 'vertical' | 'horizontal';
}

export function RadioInput<T extends string | number>({
  options,
  value,
  onValueChange,
  disabled = false,
  groupLabel,
  direction = 'vertical',
  style,
  ...props
}: RadioInputProps<T>) {
  const { colors } = useTheme();

  const handleSelect = useCallback(
    (selectedValue: T) => {
      if (!disabled) {
        onValueChange(selectedValue);
      }
    },
    [onValueChange, disabled]
  );

  return (
    <View style={[styles.container, style]} {...props}>
      {groupLabel && (
        <Text
          style={[
            styles.groupLabel,
            {
              color: colors.text,
            },
          ]}
          accessibilityRole="header"
        >
          {groupLabel}
        </Text>
      )}

      <View
        style={[
          styles.optionsContainer,
          {
            flexDirection: direction === 'horizontal' ? 'row' : 'column',
          },
        ]}
        role="radiogroup"
        accessibilityLabel={groupLabel}
      >
        {options.map((option) => {
          const isSelected = option.value === value;
          const optionDisabled = disabled || option.disabled;

          return (
            <Pressable
              key={String(option.value)}
              style={[
                styles.optionContainer,
                {
                  opacity: optionDisabled ? 0.5 : 1,
                  marginRight: direction === 'horizontal' ? Spacing.lg : 0,
                  marginBottom: direction === 'vertical' ? Spacing.base : 0,
                },
              ]}
              onPress={() => handleSelect(option.value)}
              disabled={optionDisabled}
              accessibilityRole="radio"
              accessibilityState={{
                selected: isSelected,
                disabled: optionDisabled,
              }}
              accessibilityLabel={option.label}
            >
              <View
                style={[
                  styles.radio,
                  {
                    borderColor: isSelected ? colors.primary : colors.border,
                    borderWidth: 2,
                    backgroundColor: isSelected ? colors.primary : colors.surface,
                  },
                ]}
              >
                {isSelected && (
                  <View
                    style={[
                      styles.radioInner,
                      {
                        backgroundColor: colors.textInverse,
                      },
                    ]}
                  />
                )}
              </View>

              <Text
                style={[
                  styles.label,
                  {
                    color: colors.text,
                  },
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing.base,
  },
  groupLabel: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    marginBottom: Spacing.base,
  },
  optionsContainer: {
    gap: Spacing.base,
  },
  optionContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.base,
  },
  radio: {
    width: 24,
    height: 24,
    borderRadius: Radius.full,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioInner: {
    width: 8,
    height: 8,
    borderRadius: Radius.full,
  },
  label: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.medium,
    flex: 1,
  },
});
