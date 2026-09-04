# Tamgora Mobile Application

React Native mobile application for the Tamgora platform, built with Expo.

## Issues Implemented

This implementation addresses the following GitHub issues:

### Issue #563: Interactive Onboarding Walkthrough
**"Design standard distinct comprehensive interactive new user Application walkthroughs visually"**

**Implementation:** `src/components/onboarding/OnboardingWalkthrough.tsx`

Features:
- Multi-step interactive walkthrough with 5 comprehensive steps
- Swipeable carousel with smooth gesture support
- Animated progress indicators with dynamic dot sizing
- Skip functionality for experienced users
- Haptic feedback on all interactions
- Full dark mode support with theme integration
- Optimized rendering with zero frame drops
- Accessible with proper ARIA labels and roles
- Auto-scroll and pagination tracking

**Usage:**
```tsx
import { OnboardingWalkthrough } from './components/onboarding/OnboardingWalkthrough';

<OnboardingWalkthrough 
  onComplete={() => console.log('Onboarding completed')}
  onSkip={() => console.log('Onboarding skipped')}
/>
```

---

### Issue #562: Mobile Form Validation
**"Leverage specific generalized standard localized Mobile form validations identically securely"**

**Implementation:** `src/utils/formValidation.ts` + `src/components/forms/ValidatedInput.tsx`

Features:
- Comprehensive validation rules (email, password, phone, URL, Stellar address, etc.)
- Localized error messages
- Type-safe validation functions
- Secure input sanitization (HTML stripping, XSS prevention)
- Real-time and on-blur validation support
- Custom validation rule composition
- Debounced validation to prevent performance issues
- Form-level validation with error aggregation
- Common validator presets for login, signup, profiles, bounties

**Available Validators:**
- `required` - Required field validation
- `email` - RFC 5322 compliant email validation
- `password` - Strong password requirements
- `phone` - International phone number format
- `url` - Valid URL validation
- `numeric` - Number validation
- `range` - Min/max range validation
- `minLength` / `maxLength` - Length constraints
- `pattern` - Custom regex patterns
- `match` - Value matching (password confirmation)
- `stellarAddress` - Stellar blockchain address validation
- `username` - Alphanumeric username validation

**Usage:**
```tsx
import { ValidatedInput } from './components/forms/ValidatedInput';
import { Validators, Sanitizers, composeValidators } from './utils/formValidation';

<ValidatedInput
  label="Email"
  value={email}
  onChangeText={setEmail}
  validator={composeValidators(
    Validators.required('Email is required'),
    Validators.email()
  )}
  sanitizer={Sanitizers.lowercase}
  validateOnChange
  required
/>
```

---

### Issue #558: Direct Messaging Layout
**"Develop specific distinct interactive Direct Messaging layout architectures"**

**Implementation:** `src/screens/MessagingScreen.tsx`

Features:
- Real-time message display with optimized FlatList rendering
- Distinct message bubbles for sender/receiver with color coding
- Message status indicators (sending, sent, delivered, read, failed)
- Typing indicators with animated dots
- Relative timestamps (just now, 5m ago, 2h ago, etc.)
- Keyboard-aware layout that adjusts to keyboard
- Pull-to-refresh for loading message history
- Message input with character limit (1000 chars)
- Send button with disabled state for empty messages
- Full dark mode support
- Zero frame drops with memoized rendering
- Accessibility labels and roles
- Haptic feedback on send

**Usage:**
```tsx
import { MessagingScreen } from './screens/MessagingScreen';

<MessagingScreen
  conversationId="conv-123"
  currentUserId="user-1"
  recipientName="Alice Johnson"
  onBack={() => navigation.goBack()}
/>
```

---

### Issue #559: WebSocket Integration
**"Integrate specific fluid interactive standard Websocket capabilities comprehensively"**

**Implementation:** 
- `src/services/WebSocketService.ts` - Core WebSocket service
- `src/hooks/useWebSocketConnection.ts` - React hooks for WebSocket

Features:
- Robust WebSocket connection management
- Automatic reconnection with exponential backoff (max 10 attempts)
- Connection state tracking (connecting, connected, disconnected, reconnecting, error)
- Message queuing for offline scenarios (up to 100 messages)
- Event-based message handling with type safety
- Heartbeat/ping-pong for connection health monitoring
- Type-safe message protocols
- Comprehensive error handling and recovery
- React hooks for easy integration
- Singleton pattern for global service instance
- Automatic cleanup on unmount

**WebSocket Service Usage:**
```tsx
import { WebSocketService } from './services/WebSocketService';

const ws = new WebSocketService({
  url: 'wss://api.stellar.com/ws',
  reconnectInterval: 3000,
  maxReconnectAttempts: 10,
  heartbeatInterval: 30000,
});

// Connect
ws.connect();

// Send message
ws.send('chat.message', { text: 'Hello!', recipientId: 'user-2' });

// Subscribe to messages
const unsubscribe = ws.on('chat.message', (message) => {
  console.log('Received:', message.payload);
});

// Monitor connection state
ws.onStateChange((state) => {
  console.log('Connection state:', state);
});

// Cleanup
ws.disconnect();
```

**React Hook Usage:**
```tsx
import { useWebSocketConnection } from './hooks/useWebSocketConnection';
import { getWebSocketService } from './services/WebSocketService';

function ChatComponent() {
  const ws = getWebSocketService({ url: 'wss://api.stellar.com/ws' });
  const { connectionState, isConnected, send, subscribe } = useWebSocketConnection(ws);

  useEffect(() => {
    const unsubscribe = subscribe('chat.message', (message) => {
      console.log('New message:', message.payload);
    });
    return unsubscribe;
  }, [subscribe]);

  const handleSend = () => {
    send('chat.message', { text: 'Hello!' });
  };

  return (
    <View>
      <Text>Status: {connectionState}</Text>
      <Button onPress={handleSend} disabled={!isConnected} title="Send" />
    </View>
  );
}
```

---

## Project Structure

`mobile/src/` has grown substantially past what earlier revisions of this
README described — it now has top-level areas for AI/ML (`ai/`,
`upscaling/`), real-time collaboration (`canvas/`, `messaging/`), offline
storage (`database/`, `offline/`, `cache/`), OTA updates (`ota/`),
telemetry, subtitling, tipping, and more, alongside the
onboarding/forms/messaging/WebSocket work called out above. Current
top-level directories under `mobile/src/`:

```
ai/  animation/  cache/  canvas/  components/  config/  constants/
context/  database/  examples/  haptics/  hooks/  i18n/  media/
messaging/  navigation/  offline/  ota/  screens/  services/  store/
subtitling/  telemetry/  theme/  tipping/  types/  upscaling/  utils/
```

This list will drift again as the app grows — treat `mobile/src/`'s actual
directory listing as the source of truth over any snapshot committed here.
`mobile/INFINITE_SCROLLING.md` documents the infinite-scroll/memory-
optimization subsystem specifically.

## Installation

```bash
cd mobile
npm install
# or
yarn install
```

## Running the App

### Development

```bash
npm start          # Start the Expo dev server (Metro bundler + QR code)
npm run ios        # expo run:ios — build and run on the iOS simulator
npm run android    # expo run:android — build and run on the Android emulator
```

There is no `npm run web` script — this app does not currently support
running in a browser.

### Production Build

```bash
npm run build:ios      # eas build --platform ios
npm run build:android  # eas build --platform android
```

## Dependencies

Notable ones (see `package.json` for the full, current list — this app has
grown well past navigation/forms/offline into real-time collaboration,
E2E-encrypted messaging, and on-device ML, none of which the original
version of this section mentioned):

- **Core**: `expo` ~56.1.0, `react` 18.2.0, `react-native` 0.85.0, `expo-router` (file-based routing, the app's `main` entry point)
- **Real-time collaboration**: `yjs`, `y-websocket`, `lib0` (CRDT sync)
- **Messaging security**: `@signalapp/libsignal-client` (Signal protocol E2E encryption), `expo-secure-store`
- **Offline storage**: `@nozbe/watermelondb`
- **Media/AV**: `react-native-webrtc`, `react-native-video`, `ffmpeg-kit-react-native`, `expo-av`
- **Graphics/animation**: `@shopify/react-native-skia`, `react-native-reanimated`, `react-native-gesture-handler`
- **On-device ML**: `onnxruntime-react-native`
- **Navigation**: `@react-navigation/native`, `@react-navigation/native-stack`, `@react-navigation/bottom-tabs` (alongside `expo-router`)

## Testing

```bash
npm test          # jest
npm run test:watch
```

There is no `type-check` or `lint` npm script in this package — TypeScript
errors surface via your editor or `tsc` run directly; there's no
dedicated lint config here either.

## Features

### Offline Support
- Automatic data caching with AsyncStorage
- Offline operation queue
- Network state detection
- Stale data indicators
- Pull-to-refresh

### Theme Support
- Light and dark modes
- System theme detection
- Persistent theme preference
- Smooth theme transitions

### Performance
- Optimized FlatList rendering
- Memoized components
- Debounced validation
- Zero frame drops
- Efficient re-renders

### Accessibility
- ARIA labels and roles
- Screen reader support
- Keyboard navigation
- High contrast support
- Semantic HTML

## Environment Variables

Create a `.env` file in the mobile directory:

```env
EXPO_PUBLIC_API_URL=https://api.stellar.com
EXPO_PUBLIC_WS_URL=wss://api.stellar.com/ws
EXPO_PUBLIC_STELLAR_NETWORK=testnet
```

## Contributing

1. Create a feature branch
2. Implement changes
3. Run `npm test` (there's no separate type-check/lint script here — see Testing above)
4. Test on iOS and Android
5. Submit pull request

## License

MIT License - See LICENSE file for details
