/**
 * PreferenceSlider Component
 * Optimized slider for numeric preference values
 */

import React, { memo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Slider from '@react-native-community/slider';

interface PreferenceSliderProps {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onValueChange: (value: number) => void;
  disabled?: boolean;
  testID?: string;
  formatValue?: (value: number) => string;
}

export const PreferenceSlider = memo<PreferenceSliderProps>(({
  label,
  description,
  value,
  min,
  max,
  step = 1,
  onValueChange,
  disabled = false,
  testID,
  formatValue = (val) => String(val),
}) => {
  const [currentValue, setCurrentValue] = useState(value);

  const handleValueChange = (newValue: number) => {
    setCurrentValue(newValue);
  };

  const handleSlidingComplete = (newValue: number) => {
    onValueChange(newValue);
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerContainer}>
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
        <Text style={[styles.valueText, disabled && styles.disabledText]}>
          {formatValue(currentValue)}
        </Text>
      </View>
      <Slider
        style={styles.slider}
        value={currentValue}
        minimumValue={min}
        maximumValue={max}
        step={step}
        onValueChange={handleValueChange}
        onSlidingComplete={handleSlidingComplete}
        disabled={disabled}
        testID={testID}
        minimumTrackTintColor="#6366f1"
        maximumTrackTintColor="#d1d5db"
        thumbTintColor="#6366f1"
      />
      <View style={styles.rangeContainer}>
        <Text style={styles.rangeText}>{formatValue(min)}</Text>
        <Text style={styles.rangeText}>{formatValue(max)}</Text>
      </View>
    </View>
  );
});

PreferenceSlider.displayName = 'PreferenceSlider';

const styles = StyleSheet.create({
  container: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#ffffff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
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
  valueText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6366f1',
  },
  disabledText: {
    opacity: 0.5,
  },
  slider: {
    width: '100%',
    height: 40,
  },
  rangeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -8,
  },
  rangeText: {
    fontSize: 12,
    color: '#9ca3af',
  },
});
