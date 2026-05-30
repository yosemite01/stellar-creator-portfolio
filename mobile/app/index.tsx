/**
 * App entry route (`/`).
 *
 * Reads the current authentication state and immediately redirects to the
 * correct route group so the user never sees the wrong screen:
 * - authenticated   → `(app)/home`
 * - unauthenticated → `(auth)/login`
 *
 * The auth state is wired to the Zustand auth store in Issue 3. Until then a
 * conservative default of "unauthenticated" is used. Once the persisted store
 * lands, gate this redirect on `isHydrated` to avoid a flash of the wrong route.
 */
import { Redirect } from 'expo-router';
import { ROUTES } from '../src/constants/routes';

/**
 * Index route component that resolves auth state into a single redirect.
 *
 * @returns A {@link Redirect} to either the authenticated or auth route group.
 */
export default function Index(): React.JSX.Element {
  // TODO(Issue 3): replace with `useAuthStore` selector + `isHydrated` gating.
  const isAuthenticated = false;

  return (
    <Redirect href={isAuthenticated ? ROUTES.APP.HOME : ROUTES.AUTH.LOGIN} />
  );
}
