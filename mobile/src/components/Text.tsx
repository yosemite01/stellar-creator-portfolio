/**
 * Typed `Text` wrapper that enforces the design-system typography scale.
 *
 * Styling comes through the `variant` prop only — `fontSize`, `fontWeight`, and
 * `lineHeight` are intentionally removed from the accepted `style` prop (via
 * `Omit`) so screens cannot bypass the scale. The semantic text color is
 * resolved from the active color scheme, and can be overridden with `color`.
 */
import React, { memo, useMemo } from 'react';
import {
  Text as RNText,
  useColorScheme,
  type StyleProp,
  type TextProps as RNTextProps,
  type TextStyle,
} from 'react-native';
import { colors } from '../theme/colors';
import { typography, type TypographyVariant } from '../theme/typography';

/** `TextStyle` with the scale-owned keys removed so they can't be overridden. */
export type RestrictedTextStyle = Omit<
  TextStyle,
  'fontSize' | 'fontWeight' | 'lineHeight'
>;

/** Props for the {@link Text} component. */
export interface TextProps extends Omit<RNTextProps, 'style'> {
  /** Typography scale variant. Defaults to `bodyMedium`. */
  variant?: TypographyVariant;
  /** Optional override for the semantic text color. */
  color?: string;
  /**
   * Additional text styles. `fontSize`, `fontWeight`, and `lineHeight` are
   * disallowed — use `variant` instead.
   */
  style?: StyleProp<RestrictedTextStyle>;
}

/**
 * Design-system text component.
 *
 * @param props - {@link TextProps}
 * @returns A styled React Native `<Text>`.
 */
function TextComponent({
  variant = 'bodyMedium',
  color,
  style,
  ...rest
}: TextProps): React.JSX.Element {
  const colorScheme = useColorScheme();
  const palette = colors[colorScheme === 'dark' ? 'dark' : 'light'];
  const resolvedColor = color ?? palette.textPrimary;

  const baseStyle = useMemo<StyleProp<TextStyle>>(
    () => [typography[variant], { color: resolvedColor }],
    [variant, resolvedColor],
  );

  return <RNText style={[baseStyle, style]} {...rest} />;
}

/** Memoized design-system {@link TextComponent}. */
export const Text = memo(TextComponent);
Text.displayName = 'Text';
