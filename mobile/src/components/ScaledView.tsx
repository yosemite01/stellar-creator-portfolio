import React, { memo } from 'react';
import {
  View as RNView,
  type ViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useFontScale } from '../utils/accessibility';

/**
 * Scaled View component that automatically scales padding and margin based on
 * the device's font scale setting.
 */
export interface ScaledViewProps extends ViewProps {
  /**
   * Padding to apply (will be scaled by font scale).
   * Can be a number (applied to all sides) or an object with specific sides.
   */
  padding?:
    | number
    | {
        top?: number;
        bottom?: number;
        left?: number;
        right?: number;
      };
  /**
   * Margin to apply (will be scaled by font scale).
   * Can be a number (applied to all sides) or an object with specific sides.
   */
  margin?:
    | number
    | {
        top?: number;
        bottom?: number;
        left?: number;
        right?: number;
      };
}

function ScaledViewComponent({
  padding,
  margin,
  style,
  ...props
}: ScaledViewProps) {
  const fontScale = useFontScale();

  const computeScaledSpacing = (
    value: number | undefined
  ): number | undefined => {
    if (value === undefined) return undefined;
    return value * fontScale;
  };

  const computeScaledPadding = (
    paddingProp: number | { top?: number; bottom?: number; left?: number; right?: number } | undefined
  ): ViewStyle => {
    if (paddingProp === undefined) return {};
    if (typeof paddingProp === 'number') {
      const scaled = computeScaledSpacing(paddingProp);
      return { padding: scaled };
    }
    const scaled = {
      top: computeScaledSpacing(paddingProp.top),
      bottom: computeScaledSpacing(paddingProp.bottom),
      left: computeScaledSpacing(paddingProp.left),
      right: computeScaledSpacing(paddingProp.right),
    };
    // Remove undefined values
    return Object.fromEntries(
      Object.entries(scaled).filter(([, v]) => v !== undefined)
    ) as ViewStyle;
  };

  const computeScaledMargin = (
    marginProp: number | { top?: number; bottom?: number; left?: number; right?: number } | undefined
  ): ViewStyle => {
    if (marginProp === undefined) return {};
    if (typeof marginProp === 'number') {
      const scaled = computeScaledSpacing(marginProp);
      return { margin: scaled };
    }
    const scaled = {
      top: computeScaledSpacing(marginProp.top),
      bottom: computeScaledSpacing(marginProp.bottom),
      left: computeScaledSpacing(marginProp.left),
      right: computeScaledSpacing(marginProp.right),
    };
    // Remove undefined values
    return Object.fromEntries(
      Object.entries(scaled).filter(([, v]) => v !== undefined)
    ) as ViewStyle;
  };

  const baseStyle = useMemo<StyleProp<ViewStyle>>(() => {
    return [
      computeScaledPadding(padding),
      computeScaledMargin(margin),
    ];
  }, [padding, margin, fontScale]);

  return <RNView style={[baseStyle, style]} {...props} />;
}

/** Memoized scaled view component. */
export const ScaledView = memo(ScaledViewComponent);
ScaledView.displayName = 'ScaledView';