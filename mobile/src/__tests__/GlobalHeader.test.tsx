/**
 * Static unit + snapshot tests for {@link GlobalHeader}.
 *
 * No emulator: `expo-router` and `react-native-safe-area-context` are mocked,
 * and `Platform`/`StatusBar` are patched to exercise the iOS vs Android paths.
 */
import React from 'react';
import { Platform, StatusBar, Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

const mockRouterBack = jest.fn();
jest.mock('expo-router', () => ({
  router: { back: () => mockRouterBack() },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 0, left: 0, right: 0 }),
}));

import { GlobalHeader } from '../components/GlobalHeader';

type SelectSpec<T> = { ios?: T; android?: T; default?: T };
type MutablePlatform = {
  OS: 'ios' | 'android';
  select: <T>(spec: SelectSpec<T>) => T | undefined;
};

const mutablePlatform = Platform as unknown as MutablePlatform;
const mutableStatusBar = StatusBar as unknown as { currentHeight: number | undefined };

const originalOS = mutablePlatform.OS;
const originalSelect = mutablePlatform.select;
const originalStatusBarHeight = mutableStatusBar.currentHeight;

/** Patch Platform so both `OS` and `select` reflect the requested platform. */
function setPlatform(os: 'ios' | 'android'): void {
  mutablePlatform.OS = os;
  mutablePlatform.select = <T,>(spec: SelectSpec<T>): T | undefined =>
    os === 'android' ? spec.android ?? spec.default : spec.ios ?? spec.default;
}

beforeEach(() => {
  mockRouterBack.mockClear();
  setPlatform('ios');
  mutableStatusBar.currentHeight = undefined;
});

afterAll(() => {
  mutablePlatform.OS = originalOS;
  mutablePlatform.select = originalSelect;
  mutableStatusBar.currentHeight = originalStatusBarHeight;
});

describe('GlobalHeader', () => {
  it('renders with title only (no back button, no right action)', () => {
    const { getByText, queryByLabelText } = render(<GlobalHeader title="Home" />);
    expect(getByText('Home')).toBeTruthy();
    expect(queryByLabelText('Go back')).toBeNull();
  });

  it('shows the back button when showBackButton is true', () => {
    const { getByLabelText } = render(
      <GlobalHeader title="Details" showBackButton />,
    );
    const back = getByLabelText('Go back');
    expect(back).toBeTruthy();
    expect(back.props.accessibilityRole).toBe('button');
  });

  it('hides the back button when showBackButton is false', () => {
    const { queryByLabelText } = render(
      <GlobalHeader title="Details" showBackButton={false} />,
    );
    expect(queryByLabelText('Go back')).toBeNull();
  });

  it('calls onBackPress (and not router.back) when onBackPress is provided', () => {
    const onBackPress = jest.fn();
    const { getByLabelText } = render(
      <GlobalHeader title="X" showBackButton onBackPress={onBackPress} />,
    );
    fireEvent.press(getByLabelText('Go back'));
    expect(onBackPress).toHaveBeenCalledTimes(1);
    expect(mockRouterBack).not.toHaveBeenCalled();
  });

  it('falls back to router.back() when no onBackPress is provided', () => {
    const { getByLabelText } = render(<GlobalHeader title="X" showBackButton />);
    fireEvent.press(getByLabelText('Go back'));
    expect(mockRouterBack).toHaveBeenCalledTimes(1);
  });

  it('renders the rightAction node when provided', () => {
    const { getByText } = render(
      <GlobalHeader title="X" rightAction={<Text>Action</Text>} />,
    );
    expect(getByText('Action')).toBeTruthy();
  });

  it('exposes an accessible title (header role + label)', () => {
    const { getByText } = render(<GlobalHeader title="Profile" />);
    const title = getByText('Profile');
    expect(title.props.accessibilityRole).toBe('header');
    expect(title.props.accessibilityLabel).toBe('Profile');
  });

  it('matches the iOS snapshot', () => {
    setPlatform('ios');
    const { toJSON } = render(<GlobalHeader title="Home" showBackButton />);
    expect(toJSON()).toMatchSnapshot();
  });

  it('matches the Android snapshot', () => {
    setPlatform('android');
    mutableStatusBar.currentHeight = 24;
    const { toJSON } = render(<GlobalHeader title="Home" showBackButton />);
    expect(toJSON()).toMatchSnapshot();
  });
});
