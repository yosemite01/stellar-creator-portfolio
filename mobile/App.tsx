/**
 * Main App Entry Point
 * Stellar Creator Portfolio Mobile Application
 */

import React, { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View, StyleSheet, TouchableOpacity, Text } from 'react-native';
import { PreferencesScreen } from './src/screens/PreferencesScreen';
import { NotificationsScreen } from './src/screens/NotificationsScreen';
import { CacheScreen } from './src/screens/CacheScreen';

type Screen = 'cache' | 'notifications' | 'preferences';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('cache');

  return (
    <SafeAreaProvider>
      <View style={styles.container}>
        {currentScreen === 'cache' && (
          <CacheScreen />
        )}
        {currentScreen === 'notifications' && (
          <NotificationsScreen />
        )}
        {currentScreen === 'preferences' && (
          <PreferencesScreen />
        )}
        
        {/* Navigation Bar */}
        <View style={styles.navbar}>
          <TouchableOpacity
            style={[styles.navButton, currentScreen === 'cache' && styles.navButtonActive]}
            onPress={() => setCurrentScreen('cache')}
          >
            <Text style={[styles.navButtonText, currentScreen === 'cache' && styles.navButtonTextActive]}>
              💾 Cache
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.navButton, currentScreen === 'notifications' && styles.navButtonActive]}
            onPress={() => setCurrentScreen('notifications')}
          >
            <Text style={[styles.navButtonText, currentScreen === 'notifications' && styles.navButtonTextActive]}>
              🔔 Notify
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.navButton, currentScreen === 'preferences' && styles.navButtonActive]}
            onPress={() => setCurrentScreen('preferences')}
          >
            <Text style={[styles.navButtonText, currentScreen === 'preferences' && styles.navButtonTextActive]}>
              ⚙️ Prefs
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  navbar: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingBottom: 20,
  },
  navButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navButtonActive: {
    borderTopWidth: 2,
    borderTopColor: '#6366f1',
  },
  navButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9ca3af',
  },
  navButtonTextActive: {
    color: '#6366f1',
  },
});
