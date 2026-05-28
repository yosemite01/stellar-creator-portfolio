/**
 * PreferenceToggle Component
 * Optimized toggle switch for preference settings
 */

import React, { memo } from 'react';
import { View, Text, Switch, StyleSheet, Platform } from 'react-native';

interface PreferenceToggleProps {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  testID?: string;
}

export const PreferenceToggle = memo<PreferenceToggleProps>(({
  label,
  description,
  value,
  onValueChange,
  disabled = false,
  testID,
}) => {
  return (
    <View style={styles.container}>
      <View style={styles.textContainer}>
        <Text style={[styles.label, disabled && styles.disabledText]}>
          {label}
        </Text>
        {description && (
          <Text style={[styles.description, disabled && styles.disabledText]}>
            {description}
          </Text>
        )}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        testID={testID}
        trackColor={{ false: '#767577', true: '#81b0ff' }}
        thumbColor={value ? '#6366f1' : '#f4f3f4'}
        ios_backgroundColor="#3e3e3e"
      />
    </View>
  );
});

PreferenceToggle.displayName = 'PreferenceToggle';

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#ffffff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
    minHeight: 60,
  },
  textContainer: {
    flex: 1,
    marginRight: 12,
  },
  label: {
    fontSize: 16,
    fontWeight: '500',
    color: '#111827',
    marginBottom: 4,
  },
  description: {
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 18,
  },
  disabledText: {
    opacity: 0.5,
  },
});
