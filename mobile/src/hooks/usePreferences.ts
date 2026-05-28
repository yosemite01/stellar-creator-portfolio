/**
 * usePreferences Hook - React Hook for Preferences Management
 * Provides reactive access to user preferences with optimized performance
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { UserPreferences, DEFAULT_PREFERENCES } from '../types/preferences';
import { PreferencesService } from '../services/PreferencesService';

interface UsePreferencesReturn {
  preferences: UserPreferences;
  loading: boolean;
  error: string | null;
  updatePreferences: (updates: Partial<UserPreferences>) => Promise<boolean>;
  updateSection: <K extends keyof UserPreferences>(
    section: K,
    updates: Partial<UserPreferences[K]>
  ) => Promise<boolean>;
  resetPreferences: () => Promise<boolean>;
  refreshPreferences: () => Promise<void>;
  exportPreferences: () => Promise<string | null>;
  importPreferences: (jsonString: string) => Promise<boolean>;
}

export const usePreferences = (): UsePreferencesReturn => {
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useRef(true);

  // Load preferences on mount
  useEffect(() => {
    loadPreferences();

    return () => {
      isMounted.current = false;
    };
  }, []);

  const loadPreferences = async () => {
    try {
      setLoading(true);
      setError(null);
      const loadedPreferences = await PreferencesService.loadPreferences();
      
      if (isMounted.current) {
        setPreferences(loadedPreferences);
      }
    } catch (err) {
      if (isMounted.current) {
        setError('Failed to load preferences');
        console.error('Error loading preferences:', err);
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  };

  const updatePreferences = useCallback(
    async (updates: Partial<UserPreferences>): Promise<boolean> => {
      try {
        const updatedPreferences = { ...preferences, ...updates };
        const success = await PreferencesService.savePreferences(updatedPreferences);
        
        if (success && isMounted.current) {
          setPreferences(updatedPreferences);
        }
        
        return success;
      } catch (err) {
        console.error('Error updating preferences:', err);
        setError('Failed to update preferences');
        return false;
      }
    },
    [preferences]
  );

  const updateSection = useCallback(
    async <K extends keyof UserPreferences>(
      section: K,
      updates: Partial<UserPreferences[K]>
    ): Promise<boolean> => {
      try {
        const success = await PreferencesService.updatePreferenceSection(section, updates);
        
        if (success && isMounted.current) {
          setPreferences(prev => ({
            ...prev,
            [section]: { ...prev[section], ...updates },
          }));
        }
        
        return success;
      } catch (err) {
        console.error('Error updating preference section:', err);
        setError('Failed to update preference section');
        return false;
      }
    },
    []
  );

  const resetPreferences = useCallback(async (): Promise<boolean> => {
    try {
      const success = await PreferencesService.resetPreferences();
      
      if (success && isMounted.current) {
        setPreferences(DEFAULT_PREFERENCES);
      }
      
      return success;
    } catch (err) {
      console.error('Error resetting preferences:', err);
      setError('Failed to reset preferences');
      return false;
    }
  }, []);

  const refreshPreferences = useCallback(async (): Promise<void> => {
    await loadPreferences();
  }, []);

  const exportPreferences = useCallback(async (): Promise<string | null> => {
    try {
      return await PreferencesService.exportPreferences();
    } catch (err) {
      console.error('Error exporting preferences:', err);
      setError('Failed to export preferences');
      return null;
    }
  }, []);

  const importPreferences = useCallback(async (jsonString: string): Promise<boolean> => {
    try {
      const success = await PreferencesService.importPreferences(jsonString);
      
      if (success) {
        await refreshPreferences();
      }
      
      return success;
    } catch (err) {
      console.error('Error importing preferences:', err);
      setError('Failed to import preferences');
      return false;
    }
  }, [refreshPreferences]);

  return {
    preferences,
    loading,
    error,
    updatePreferences,
    updateSection,
    resetPreferences,
    refreshPreferences,
    exportPreferences,
    importPreferences,
  };
};
