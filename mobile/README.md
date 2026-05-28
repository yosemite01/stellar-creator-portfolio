# Stellar Creator Portfolio - Mobile App

A comprehensive native mobile application built with React Native and Expo, featuring robust user preferences management.

## 🚀 Features

### Comprehensive Preferences System
- **Display Preferences**: Theme, font size, color scheme, high contrast, reduced motion
- **Notification Preferences**: Push, email, sound, vibration controls
- **Privacy Preferences**: Profile visibility, data sharing, analytics
- **Content Preferences**: View modes, pagination, auto-play, caching
- **Localization**: Language, region, date/time formats
- **Accessibility**: Screen reader, large text, high contrast
- **Performance**: Animations, transitions, hardware acceleration

### Native Capabilities
- ✅ AsyncStorage for persistent local storage
- ✅ Optimized rendering with React.memo
- ✅ No frame drops with efficient component updates
- ✅ Type-safe TypeScript implementation
- ✅ Modular architecture with clear separation of concerns

## 📁 Project Structure

```
mobile/
├── src/
│   ├── components/          # Reusable UI components
│   │   ├── PreferenceToggle.tsx
│   │   ├── PreferenceSelect.tsx
│   │   ├── PreferenceSlider.tsx
│   │   └── PreferenceSection.tsx
│   ├── screens/             # Screen components
│   │   └── PreferencesScreen.tsx
│   ├── services/            # Business logic services
│   │   └── PreferencesService.ts
│   ├── hooks/               # Custom React hooks
│   │   └── usePreferences.ts
│   └── types/               # TypeScript type definitions
│       └── preferences.ts
├── App.tsx                  # Main app entry point
├── app.json                 # Expo configuration
├── package.json             # Dependencies
├── tsconfig.json            # TypeScript configuration
└── babel.config.js          # Babel configuration
```

## 🛠️ Installation

1. **Install dependencies:**
   ```bash
   cd mobile
   npm install
   ```

2. **Start the development server:**
   ```bash
   npm start
   ```

3. **Run on specific platform:**
   ```bash
   npm run ios      # iOS simulator
   npm run android  # Android emulator
   npm run web      # Web browser
   ```

## 📱 Components

### PreferenceToggle
Toggle switch component for boolean preferences with optimized rendering.

### PreferenceSelect
Modal-based select component for choosing from multiple options.

### PreferenceSlider
Slider component for numeric values with real-time feedback.

### PreferenceSection
Groups related preferences with headers and descriptions.

## 🔧 Services

### PreferencesService
Handles all preference storage operations:
- Load/save preferences
- Update specific sections
- Import/export functionality
- Reset to defaults
- Merge with defaults for backward compatibility

## 🎣 Hooks

### usePreferences
React hook providing reactive access to preferences:
- Automatic loading on mount
- Optimized updates with useCallback
- Error handling
- Loading states
- Refresh capability

## 📊 Type Definitions

Comprehensive TypeScript types ensure type safety:
- `UserPreferences`: Complete preference structure
- `PreferenceSection`: Section metadata
- `PreferenceItem`: Individual preference item
- `DEFAULT_PREFERENCES`: Default values

## ⚡ Performance Optimizations

1. **Component Memoization**: All components use React.memo
2. **Callback Optimization**: useCallback for all handlers
3. **Efficient Updates**: Only affected sections re-render
4. **Native Storage**: AsyncStorage for fast local persistence
5. **No Frame Drops**: Optimized rendering pipeline

## 🎨 UI/UX Features

- Clean, modern interface
- Smooth animations and transitions
- Pull-to-refresh support
- Loading and error states
- Confirmation dialogs for destructive actions
- Accessibility support
- Dark mode ready

## 🔒 Data Persistence

Preferences are automatically saved to device storage using AsyncStorage:
- Persistent across app restarts
- Automatic merging with defaults
- Import/export capability
- Validation on load

## 🧪 Testing

The app is built with testability in mind:
- Modular architecture
- Dependency injection ready
- TestID props on interactive elements
- Pure service functions

## 📝 Usage Example

```typescript
import { usePreferences } from './src/hooks/usePreferences';

function MyComponent() {
  const { preferences, updateSection } = usePreferences();

  const toggleDarkMode = () => {
    updateSection('display', { 
      theme: preferences.display.theme === 'dark' ? 'light' : 'dark' 
    });
  };

  return (
    <Button onPress={toggleDarkMode}>
      Toggle Theme
    </Button>
  );
}
```

## 🚀 Future Enhancements

- [ ] Cloud sync for preferences
- [ ] Multiple preference profiles
- [ ] Preference presets
- [ ] Advanced search/filter
- [ ] Preference history/undo
- [ ] Biometric authentication for sensitive settings

## 📄 License

MIT License - See LICENSE file for details

## 👥 Contributing

Contributions are welcome! Please read CONTRIBUTING.md for guidelines.

## 🐛 Issues

Report issues at: https://github.com/ShantelPeters/stellar-creator-portfolio/issues
