/**
 * Layout for the `(app)` route group (authenticated screens).
 *
 * Hosts the stack for authenticated screens such as home. The shared
 * `GlobalHeader` is registered as the stack header in Issue 2.
 */
import { Stack } from 'expo-router';

/**
 * Stack navigator for authenticated routes.
 *
 * @returns A {@link Stack} for the `(app)` group.
 */
export default function AppLayout(): React.JSX.Element {
  return <Stack screenOptions={{ headerShown: false }} />;
}
