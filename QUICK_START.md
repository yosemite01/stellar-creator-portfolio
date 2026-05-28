# Quick Start Guide - Stellar Creator Portfolio Mobile

## 🚀 Get Started in 5 Minutes

### Prerequisites
- Node.js 16+ installed
- npm or yarn
- Expo CLI (optional, will be installed automatically)
- iOS Simulator (Mac) or Android Emulator

### Step 1: Install Dependencies

```bash
cd mobile
npm install
```

### Step 2: Start Development Server

```bash
npm start
```

This will open Expo Dev Tools in your browser.

### Step 3: Run on Device/Simulator

Choose one:

**iOS (Mac only):**
```bash
npm run ios
```

**Android:**
```bash
npm run android
```

**Web:**
```bash
npm run web
```

**Physical Device:**
1. Install "Expo Go" app from App Store/Play Store
2. Scan QR code from terminal/browser

## 📱 What You'll See

The app opens directly to the **Preferences Screen** with:

- 🎨 Display settings
- 🔔 Notification controls
- 🔒 Privacy options
- 📱 Content preferences
- 🌍 Language & region
- ♿ Accessibility features
- ⚡ Performance settings

## 🎮 Try These Features

### 1. Toggle Dark Mode
- Scroll to "Display" section
- Tap "Theme" → Select "Dark"
- See the change instantly

### 2. Adjust Font Size
- In "Display" section
- Tap "Font Size" → Select "Large"
- Text size updates throughout

### 3. Configure Notifications
- Scroll to "Notifications" section
- Toggle "Enable Notifications"
- Notice sub-options enable/disable automatically

### 4. Adjust Items Per Page
- Scroll to "Content" section
- Use slider to adjust "Items Per Page"
- See real-time value update

### 5. Reset All Settings
- Tap "Reset All" in top-right
- Confirm the action
- All preferences return to defaults

## 🔧 Customization

### Add a New Preference

1. **Update Types** (`src/types/preferences.ts`):
```typescript
export interface UserPreferences {
  // ... existing sections
  myNewSection: {
    myNewSetting: boolean;
  };
}
```

2. **Update Defaults**:
```typescript
export const DEFAULT_PREFERENCES: UserPreferences = {
  // ... existing defaults
  myNewSection: {
    myNewSetting: true,
  },
};
```

3. **Add to UI** (`src/screens/PreferencesScreen.tsx`):
```typescript
<PreferenceSection title="My New Section" icon="✨">
  <PreferenceToggle
    label="My New Setting"
    value={preferences.myNewSection.myNewSetting}
    onValueChange={(value) => 
      updateSection('myNewSection', { myNewSetting: value })
    }
  />
</PreferenceSection>
```

## 📖 Code Examples

### Access Preferences in Your Component

```typescript
import { usePreferences } from './src/hooks/usePreferences';

function MyComponent() {
  const { preferences, updateSection } = usePreferences();

  // Read a preference
  const isDarkMode = preferences.display.theme === 'dark';

  // Update a preference
  const toggleTheme = () => {
    updateSection('display', { 
      theme: isDarkMode ? 'light' : 'dark' 
    });
  };

  return (
    <Button onPress={toggleTheme}>
      Toggle Theme
    </Button>
  );
}
```

### Direct Service Usage

```typescript
import { PreferencesService } from './src/services/PreferencesService';

// Load preferences
const prefs = await PreferencesService.loadPreferences();

// Save preferences
await PreferencesService.savePreferences(prefs);

// Update specific section
await PreferencesService.updatePreferenceSection('display', {
  theme: 'dark'
});

// Reset to defaults
await PreferencesService.resetPreferences();

// Export as JSON
const json = await PreferencesService.exportPreferences();

// Import from JSON
await PreferencesService.importPreferences(json);
```

## 🐛 Troubleshooting

### Issue: "Module not found"
**Solution**: Run `npm install` again

### Issue: "Expo command not found"
**Solution**: Install globally: `npm install -g expo-cli`

### Issue: iOS Simulator won't open
**Solution**: Install Xcode from Mac App Store

### Issue: Android Emulator won't start
**Solution**: Install Android Studio and create an AVD

### Issue: Changes not reflecting
**Solution**: 
1. Press `r` in terminal to reload
2. Or shake device and tap "Reload"

### Issue: AsyncStorage errors
**Solution**: Clear storage:
```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';
await AsyncStorage.clear();
```

## 📚 Next Steps

1. **Read Full Documentation**: Check `README.md` and `IMPLEMENTATION.md`
2. **Explore Components**: Look at `src/components/` for reusable UI
3. **Understand Architecture**: Review `src/services/` and `src/hooks/`
4. **Add Features**: Extend preferences with your own settings
5. **Write Tests**: Add unit and integration tests

## 🎯 Key Files to Know

```
mobile/
├── App.tsx                          # Entry point
├── src/
│   ├── screens/
│   │   └── PreferencesScreen.tsx    # Main UI (START HERE)
│   ├── hooks/
│   │   └── usePreferences.ts        # React hook
│   ├── services/
│   │   └── PreferencesService.ts    # Storage logic
│   ├── types/
│   │   └── preferences.ts           # Type definitions
│   └── components/
│       ├── PreferenceToggle.tsx     # Toggle component
│       ├── PreferenceSelect.tsx     # Select component
│       ├── PreferenceSlider.tsx     # Slider component
│       └── PreferenceSection.tsx    # Section component
```

## 💡 Pro Tips

1. **Use TypeScript**: Full IntelliSense support for preferences
2. **Memoize Components**: Already done, but keep it in mind for new components
3. **Test on Real Device**: Some features work differently than simulator
4. **Check Performance**: Use React DevTools Profiler
5. **Read Inline Comments**: Code is well-documented

## 🎨 Customization Ideas

- Change color scheme (update `#6366f1` throughout)
- Add more preference types (radio groups, multi-select)
- Implement preference presets
- Add search/filter functionality
- Create preference import/export UI
- Add preference change animations

## 📞 Support

- **Documentation**: See `README.md` and `IMPLEMENTATION.md`
- **Issues**: Check GitHub issues
- **Expo Docs**: https://docs.expo.dev
- **React Native Docs**: https://reactnative.dev

## ✅ Checklist

- [ ] Dependencies installed
- [ ] Development server running
- [ ] App opens on device/simulator
- [ ] Can toggle preferences
- [ ] Preferences persist after reload
- [ ] Explored all 7 sections
- [ ] Tried reset functionality
- [ ] Read documentation
- [ ] Ready to customize!

---

**You're all set!** 🎉

Start exploring the preferences screen and customize it to your needs.
