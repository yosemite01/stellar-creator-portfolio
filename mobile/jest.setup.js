/**
 * Global Jest setup.
 *
 * - Wires up the gesture-handler test shims so components wrapped in
 *   <GestureHandlerRootView> render under react-test-renderer.
 * - Provides an in-memory AsyncStorage mock for store/persistence tests.
 */
require('react-native-gesture-handler/jestSetup');

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
