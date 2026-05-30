/**
 * Jest configuration for the Stellar mobile app.
 *
 * Uses the `jest-expo` preset so React Native / Expo modules are transformed
 * and mocked correctly. Tests are static-only (no emulator or device runs).
 */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  // Transform Expo / React Native packages that ship untranspiled ES modules.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|zustand))',
  ],
};
