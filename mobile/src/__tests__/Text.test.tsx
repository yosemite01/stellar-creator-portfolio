/**
 * Static unit + snapshot tests for the typed {@link Text} component.
 *
 * `useColorScheme` is mocked to exercise light and dark palettes without a
 * device. Includes a compile-time assertion that raw font styles are rejected.
 */
import React from 'react';
import { useColorScheme } from 'react-native';
import { render } from '@testing-library/react-native';
import { Text } from '../components/Text';
import { typography, type TypographyVariant } from '../theme/typography';
import { colors } from '../theme/colors';

jest.mock('react-native/Libraries/Utilities/useColorScheme');

const mockedUseColorScheme = useColorScheme as jest.MockedFunction<
  typeof useColorScheme
>;

beforeEach(() => {
  mockedUseColorScheme.mockReturnValue('light');
});

const allVariants = Object.keys(typography) as TypographyVariant[];

/** Flatten an RN style prop into a single object for assertions. */
function flatten(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>(
      (acc, item) => ({ ...acc, ...flatten(item) }),
      {},
    );
  }
  return (style ?? {}) as Record<string, unknown>;
}

describe('Text', () => {
  it('applies the correct fontSize/lineHeight/fontWeight for each variant', () => {
    for (const variant of allVariants) {
      const { getByText } = render(<Text variant={variant}>{variant}</Text>);
      const flat = flatten(getByText(variant).props.style);
      expect(flat.fontSize).toBe(typography[variant].fontSize);
      expect(flat.lineHeight).toBe(typography[variant].lineHeight);
      expect(flat.fontWeight).toBe(typography[variant].fontWeight);
    }
  });

  it('defaults to the bodyMedium variant when none is given', () => {
    const { getByText } = render(<Text>Hello</Text>);
    const flat = flatten(getByText('Hello').props.style);
    expect(flat.fontSize).toBe(typography.bodyMedium.fontSize);
  });

  it('uses the light-scheme primary color by default', () => {
    mockedUseColorScheme.mockReturnValue('light');
    const { getByText } = render(<Text>Light</Text>);
    expect(flatten(getByText('Light').props.style).color).toBe(
      colors.light.textPrimary,
    );
  });

  it('uses the dark-scheme primary color in dark mode', () => {
    mockedUseColorScheme.mockReturnValue('dark');
    const { getByText } = render(<Text>Dark</Text>);
    expect(flatten(getByText('Dark').props.style).color).toBe(
      colors.dark.textPrimary,
    );
  });

  it('honors an explicit color override', () => {
    const { getByText } = render(<Text color="#ff0000">Red</Text>);
    expect(flatten(getByText('Red').props.style).color).toBe('#ff0000');
  });

  it('matches the snapshot in light and dark mode', () => {
    mockedUseColorScheme.mockReturnValue('light');
    const light = render(<Text variant="headingLarge">Title</Text>).toJSON();
    expect(light).toMatchSnapshot('headingLarge-light');

    mockedUseColorScheme.mockReturnValue('dark');
    const dark = render(<Text variant="headingLarge">Title</Text>).toJSON();
    expect(dark).toMatchSnapshot('headingLarge-dark');
  });

  it('rejects raw font styles at compile time (type-level test)', () => {
    // @ts-expect-error fontSize must come through `variant`, not `style`.
    const _bad = <Text style={{ fontSize: 99 }}>nope</Text>;
    expect(_bad).toBeTruthy();
  });
});
