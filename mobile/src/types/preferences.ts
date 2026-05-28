/**
 * Comprehensive Preferences Type Definitions
 * Native mobile preferences mapping for Stellar Creator Portfolio
 */

export interface UserPreferences {
  // Display Preferences
  display: {
    theme: 'light' | 'dark' | 'auto';
    fontSize: 'small' | 'medium' | 'large' | 'extra-large';
    colorScheme: string;
    highContrast: boolean;
    reducedMotion: boolean;
  };
  
  // Notification Preferences
  notifications: {
    enabled: boolean;
    pushEnabled: boolean;
    emailEnabled: boolean;
    projectUpdates: boolean;
    portfolioViews: boolean;
    messages: boolean;
    soundEnabled: boolean;
    vibrationEnabled: boolean;
  };
  
  // Privacy Preferences
  privacy: {
    profileVisibility: 'public' | 'private' | 'connections-only';
    showEmail: boolean;
    showPhone: boolean;
    showLocation: boolean;
    analyticsEnabled: boolean;
    dataCollection: boolean;
  };
  
  // Content Preferences
  content: {
    defaultView: 'grid' | 'list' | 'masonry';
    itemsPerPage: number;
    autoPlayVideos: boolean;
    showThumbnails: boolean;
    cacheImages: boolean;
    dataUsageMode: 'low' | 'medium' | 'high';
  };
  
  // Language & Region
  localization: {
    language: string;
    region: string;
    dateFormat: string;
    timeFormat: '12h' | '24h';
    currency: string;
  };
  
  // Accessibility Preferences
  accessibility: {
    screenReader: boolean;
    voiceOver: boolean;
    largeText: boolean;
    boldText: boolean;
    buttonShapes: boolean;
    increaseContrast: boolean;
  };
  
  // Performance Preferences
  performance: {
    enableAnimations: boolean;
    enableTransitions: boolean;
    hardwareAcceleration: boolean;
    prefetchContent: boolean;
    backgroundSync: boolean;
  };
}

export interface PreferenceSection {
  id: string;
  title: string;
  icon: string;
  description: string;
  items: PreferenceItem[];
}

export interface PreferenceItem {
  id: string;
  label: string;
  type: 'toggle' | 'select' | 'slider' | 'input' | 'radio';
  value: any;
  options?: Array<{ label: string; value: any }>;
  min?: number;
  max?: number;
  step?: number;
  description?: string;
  disabled?: boolean;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  display: {
    theme: 'auto',
    fontSize: 'medium',
    colorScheme: '#6366f1',
    highContrast: false,
    reducedMotion: false,
  },
  notifications: {
    enabled: true,
    pushEnabled: true,
    emailEnabled: true,
    projectUpdates: true,
    portfolioViews: true,
    messages: true,
    soundEnabled: true,
    vibrationEnabled: true,
  },
  privacy: {
    profileVisibility: 'public',
    showEmail: false,
    showPhone: false,
    showLocation: true,
    analyticsEnabled: true,
    dataCollection: true,
  },
  content: {
    defaultView: 'grid',
    itemsPerPage: 20,
    autoPlayVideos: false,
    showThumbnails: true,
    cacheImages: true,
    dataUsageMode: 'medium',
  },
  localization: {
    language: 'en',
    region: 'US',
    dateFormat: 'MM/DD/YYYY',
    timeFormat: '12h',
    currency: 'USD',
  },
  accessibility: {
    screenReader: false,
    voiceOver: false,
    largeText: false,
    boldText: false,
    buttonShapes: false,
    increaseContrast: false,
  },
  performance: {
    enableAnimations: true,
    enableTransitions: true,
    hardwareAcceleration: true,
    prefetchContent: true,
    backgroundSync: true,
  },
};
