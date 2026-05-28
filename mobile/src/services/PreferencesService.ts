/**
 * Preferences Service - Native Storage and Management
 * Handles all preference operations with AsyncStorage
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { UserPreferences, DEFAULT_PREFERENCES } from '../types/preferences';

const PREFERENCES_KEY = '@stellar_creator_preferences';

export class PreferencesService {
  /**
   * Load user preferences from native storage
   */
  static async loadPreferences(): Promise<UserPreferences> {
    try {
      const storedPreferences = await AsyncStorage.getItem(PREFERENCES_KEY);
      
      if (storedPreferences) {
        const parsed = JSON.parse(storedPreferences);
        // Merge with defaults to ensure all fields exist
        return this.mergeWithDefaults(parsed);
      }
      
      // Return defaults if no stored preferences
      return DEFAULT_PREFERENCES;
    } catch (error) {
      console.error('Error loading preferences:', error);
      return DEFAULT_PREFERENCES;
    }
  }

  /**
   * Save user preferences to native storage
   */
  static async savePreferences(preferences: UserPreferences): Promise<boolean> {
    try {
      const serialized = JSON.stringify(preferences);
      await AsyncStorage.setItem(PREFERENCES_KEY, serialized);
      return true;
    } catch (error) {
      console.error('Error saving preferences:', error);
      return false;
    }
  }

  /**
   * Update a specific preference section
   */
  static async updatePreferenceSection<K extends keyof UserPreferences>(
    section: K,
    updates: Partial<UserPreferences[K]>
  ): Promise<boolean> {
    try {
      const currentPreferences = await this.loadPreferences();
      
      currentPreferences[section] = {
        ...currentPreferences[section],
        ...updates,
      };
      
      return await this.savePreferences(currentPreferences);
    } catch (error) {
      console.error('Error updating preference section:', error);
      return false;
    }
  }

  /**
   * Reset preferences to defaults
   */
  static async resetPreferences(): Promise<boolean> {
    try {
      await AsyncStorage.removeItem(PREFERENCES_KEY);
      return true;
    } catch (error) {
      console.error('Error resetting preferences:', error);
      return false;
    }
  }

  /**
   * Export preferences as JSON string
   */
  static async exportPreferences(): Promise<string | null> {
    try {
      const preferences = await this.loadPreferences();
      return JSON.stringify(preferences, null, 2);
    } catch (error) {
      console.error('Error exporting preferences:', error);
      return null;
    }
  }

  /**
   * Import preferences from JSON string
   */
  static async importPreferences(jsonString: string): Promise<boolean> {
    try {
      const preferences = JSON.parse(jsonString);
      const merged = this.mergeWithDefaults(preferences);
      return await this.savePreferences(merged);
    } catch (error) {
      console.error('Error importing preferences:', error);
      return false;
    }
  }

  /**
   * Merge stored preferences with defaults to ensure all fields exist
   */
  private static mergeWithDefaults(stored: Partial<UserPreferences>): UserPreferences {
    return {
      display: { ...DEFAULT_PREFERENCES.display, ...stored.display },
      notifications: { ...DEFAULT_PREFERENCES.notifications, ...stored.notifications },
      privacy: { ...DEFAULT_PREFERENCES.privacy, ...stored.privacy },
      content: { ...DEFAULT_PREFERENCES.content, ...stored.content },
      localization: { ...DEFAULT_PREFERENCES.localization, ...stored.localization },
      accessibility: { ...DEFAULT_PREFERENCES.accessibility, ...stored.accessibility },
      performance: { ...DEFAULT_PREFERENCES.performance, ...stored.performance },
    };
  }

  /**
   * Get a specific preference value
   */
  static async getPreference<K extends keyof UserPreferences>(
    section: K,
    key: keyof UserPreferences[K]
  ): Promise<any> {
    try {
      const preferences = await this.loadPreferences();
      return preferences[section][key];
    } catch (error) {
      console.error('Error getting preference:', error);
      return DEFAULT_PREFERENCES[section][key];
    }
  }

  /**
   * Set a specific preference value
   */
  static async setPreference<K extends keyof UserPreferences>(
    section: K,
    key: keyof UserPreferences[K],
    value: any
  ): Promise<boolean> {
    try {
      const preferences = await this.loadPreferences();
      (preferences[section] as any)[key] = value;
      return await this.savePreferences(preferences);
    } catch (error) {
      console.error('Error setting preference:', error);
      return false;
    }
  }

  /**
   * Validate preferences structure
   */
  static validatePreferences(preferences: any): boolean {
    const requiredSections = [
      'display',
      'notifications',
      'privacy',
      'content',
      'localization',
      'accessibility',
      'performance',
    ];

    return requiredSections.every(section => section in preferences);
  }
}
