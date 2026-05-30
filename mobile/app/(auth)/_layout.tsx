/**
 * Layout for the `(auth)` route group (unauthenticated screens).
 *
 * Hosts a headerless stack for screens such as login and onboarding.
 */
import { Stack } from 'expo-router';

/**
 * Stack navigator for unauthenticated routes.
 *
 * @returns A headerless {@link Stack} for the `(auth)` group.
 */
export default function AuthLayout(): React.JSX.Element {
  return <Stack screenOptions={{ headerShown: false }} />;
}
