/**
 * Main Exports
 * Public API for the preferences module
 */

// Types
export * from './types/preferences';

// Services
export { PreferencesService } from './services/PreferencesService';

// Hooks
export { usePreferences } from './hooks/usePreferences';

// Components
export {
  PreferenceToggle,
  PreferenceSelect,
  PreferenceSlider,
  PreferenceCard
} from './components';

// Screens
export { PreferencesScreen } from './screens/PreferencesScreen';
