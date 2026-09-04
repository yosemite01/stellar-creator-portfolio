/**
 * App entry route (`/`).
 *
 * Reads the current authentication state and immediately redirects to the
 * correct route group so the user never sees the wrong screen:
 * - authenticated   → `(app)/home`
 * - unauthenticated → `(auth)/login`
 *
 * Issue 3: wired to the persisted `useAuthStore`. The store's
 * `isHydrated` flag starts `false` and flips to `true` once the persisted
 * session has been read back from storage (see `src/store/authStore.ts`);
 * this gates the redirect on it so a returning, already-authenticated user
 * is never flashed the login screen before rehydration completes.
 */
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { ROUTES } from '../src/constants/routes';
import { useAuthStore } from '../src/store/authStore';

/**
 * Index route component that resolves auth state into a single redirect.
 *
 * @returns A loading indicator while the persisted session is rehydrating,
 * then a {@link Redirect} to either the authenticated or auth route group.
 */
export default function Index(): React.JSX.Element {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isHydrated = useAuthStore((state) => state.isHydrated);

  if (!isHydrated) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <Redirect href={isAuthenticated ? ROUTES.APP.HOME : ROUTES.AUTH.LOGIN} />
  );
}
