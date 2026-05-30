/**
 * Snapshot test for the root layout.
 *
 * Confirms the provider/navigator tree structure (GestureHandlerRootView →
 * Stack → declared screens) without needing an emulator. `expo-router` is
 * mocked so the Stack renders as inert host nodes.
 */
import React, { type ReactNode } from 'react';
import renderer from 'react-test-renderer';

jest.mock('expo-router', () => {
  const ReactModule = require('react') as typeof React;
  const Stack = ({ children }: { children?: ReactNode }) =>
    ReactModule.createElement('Stack', null, children);
  Stack.Screen = ({ name }: { name: string }) =>
    ReactModule.createElement('StackScreen', { name });
  return { Stack };
});

import RootLayout from '../../app/_layout';

describe('RootLayout', () => {
  it('matches the snapshot (gesture root + stack navigator tree)', () => {
    const tree = renderer.create(<RootLayout />).toJSON();
    expect(tree).toMatchSnapshot();
  });
});
