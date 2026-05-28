/**
 * Basic tests for preferences functionality
 */

import { DEFAULT_PREFERENCES } from '../src/types/preferences';
import { PreferencesService } from '../src/services/PreferencesService';

describe('Preferences System', () => {
  describe('DEFAULT_PREFERENCES', () => {
    it('should have all required sections', () => {
      expect(DEFAULT_PREFERENCES).toHaveProperty('display');
      expect(DEFAULT_PREFERENCES).toHaveProperty('notifications');
      expect(DEFAULT_PREFERENCES).toHaveProperty('privacy');
      expect(DEFAULT_PREFERENCES).toHaveProperty('content');
      expect(DEFAULT_PREFERENCES).toHaveProperty('localization');
      expect(DEFAULT_PREFERENCES).toHaveProperty('accessibility');
      expect(DEFAULT_PREFERENCES).toHaveProperty('performance');
    });

    it('should have valid default values', () => {
      expect(DEFAULT_PREFERENCES.display.theme).toBe('auto');
      expect(DEFAULT_PREFERENCES.notifications.enabled).toBe(true);
      expect(DEFAULT_PREFERENCES.privacy.profileVisibility).toBe('public');
    });
  });

  describe('PreferencesService', () => {
    it('should validate preferences structure', () => {
      const isValid = PreferencesService.validatePreferences(DEFAULT_PREFERENCES);
      expect(isValid).toBe(true);
    });

    it('should reject invalid preferences', () => {
      const invalid = { display: {} };
      const isValid = PreferencesService.validatePreferences(invalid);
      expect(isValid).toBe(false);
    });
  });
});
