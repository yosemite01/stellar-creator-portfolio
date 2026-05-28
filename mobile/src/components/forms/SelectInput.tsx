/**
 * SelectInput — Issue #531
 * "Draft standard Mobile Form Inputs and Accessibility implementations"
 *
 * Features:
 *  - Accessible select/picker input
 *  - Label and error display
 *  - Placeholder support
 *  - Dark mode support
 *  - Accessibility with screen readers
 */

import React, { useState, useCallback } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  ViewProps,
  Modal,
  SafeAreaView,
} from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { FontSize, FontWeight, Radius, Spacing } from '../../theme/tokens';

interface SelectOption<T> {
  label: string;
  value: T;
}

interface SelectInputProps<T> extends Omit<ViewProps, 'children'> {
  label: string;
  options: SelectOption<T>[];
  value?: T;
  onValueChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  errorMessage?: string;
}

export function SelectInput<T extends string | number>({
  label,
  options,
  value,
  onValueChange,
  placeholder = 'Select an option',
  disabled = false,
  required = false,
  errorMessage,
  style,
  ...props
}: SelectInputProps<T>) {
  const { colors } = useTheme();
  const [isOpen, setIsOpen] = useState(false);

  const selectedOption = options.find((opt) => opt.value === value);
  const displayValue = selectedOption?.label || placeholder;
  const hasError = !!errorMessage;

  const handleSelectOption = useCallback(
    (selectedValue: T) => {
      onValueChange(selectedValue);
      setIsOpen(false);
    },
    [onValueChange]
  );

  return (
    <View style={[styles.container, style]} {...props}>
      <Text style={[styles.label, { color: colors.text }]}>
        {label}
        {required && <Text style={[styles.required, { color: colors.error }]}> *</Text>}
      </Text>

      <Pressable
        style={[
          styles.selectButton,
          {
            backgroundColor: colors.surface,
            borderColor: hasError ? colors.error : colors.border,
            borderWidth: hasError ? 1.5 : 1,
            opacity: disabled ? 0.5 : 1,
          },
        ]}
        onPress={() => !disabled && setIsOpen(true)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={`${displayValue}, ${isOpen ? 'menu opened' : 'menu closed'}`}
        accessibilityState={{ disabled, expanded: isOpen }}
      >
        <Text
          style={[
            styles.selectValue,
            {
              color: selectedOption ? colors.text : colors.placeholder,
            },
          ]}
          numberOfLines={1}
        >
          {displayValue}
        </Text>
        <Text style={[styles.chevron, { color: colors.textSecondary }]}>
          {isOpen ? '▲' : '▼'}
        </Text>
      </Pressable>

      {hasError && (
        <Text
          style={[styles.error, { color: colors.error }]}
          accessibilityLiveRegion="polite"
        >
          {errorMessage}
        </Text>
      )}

      <Modal
        visible={isOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsOpen(false)}
        accessibilityViewIsModal
      >
        <Pressable
          style={[styles.overlay, { backgroundColor: 'rgba(0, 0, 0, 0.5)' }]}
          onPress={() => setIsOpen(false)}
        />
        <SafeAreaView style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          <View
            style={[
              styles.modal,
              {
                backgroundColor: colors.surface,
              },
            ]}
            role="menu"
          >
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text
                style={[
                  styles.modalTitle,
                  {
                    color: colors.text,
                  },
                ]}
                accessibilityRole="header"
              >
                {label}
              </Text>
              <Pressable
                onPress={() => setIsOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Close"
                style={({ pressed }) => [
                  styles.closeButton,
                  { opacity: pressed ? 0.5 : 1 },
                ]}
              >
                <Text style={[styles.closeButtonText, { color: colors.text }]}>✕</Text>
              </Pressable>
            </View>

            <ScrollView style={styles.optionsScroll} showsVerticalScrollIndicator={false}>
              {options.map((option) => (
                <Pressable
                  key={String(option.value)}
                  style={({ pressed }) => [
                    styles.option,
                    {
                      backgroundColor:
                        option.value === value
                          ? colors.primary
                          : pressed
                            ? colors.surface
                            : colors.background,
                      borderBottomColor: colors.border,
                    },
                  ]}
                  onPress={() => handleSelectOption(option.value)}
                  accessibilityRole="menuitem"
                  accessibilityLabel={option.label}
                  accessibilityState={{ selected: option.value === value }}
                >
                  <Text
                    style={[
                      styles.optionText,
                      {
                        color: option.value === value ? colors.textInverse : colors.text,
                      },
                    ]}
                  >
                    {option.label}
                  </Text>
                  {option.value === value && (
                    <Text style={[styles.checkmark, { color: colors.textInverse }]}>✓</Text>
                  )}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing.base,
  },
  label: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    marginBottom: Spacing.xs,
  },
  required: {
    fontSize: FontSize.sm,
  },
  selectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    minHeight: 44,
  },
  selectValue: {
    fontSize: FontSize.base,
    flex: 1,
  },
  chevron: {
    marginLeft: Spacing.sm,
    fontSize: FontSize.base,
  },
  error: {
    fontSize: FontSize.xs,
    marginTop: Spacing.xs,
  },
  overlay: {
    flex: 1,
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modal: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.base,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
  },
  closeButton: {
    padding: Spacing.sm,
  },
  closeButtonText: {
    fontSize: FontSize.lg,
  },
  optionsScroll: {
    maxHeight: 400,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.base,
    borderBottomWidth: 1,
    minHeight: 48,
  },
  optionText: {
    fontSize: FontSize.base,
    flex: 1,
  },
  checkmark: {
    fontSize: FontSize.lg,
    marginLeft: Spacing.base,
  },
});
