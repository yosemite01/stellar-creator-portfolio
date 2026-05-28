/**
 * Main App Entry Point
 * Stellar Creator Portfolio Mobile Application
 */

import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PreferencesScreen } from './src/screens/PreferencesScreen';

export default function App() {
  return (
    <SafeAreaProvider>
      <PreferencesScreen />
    </SafeAreaProvider>
  );
}
