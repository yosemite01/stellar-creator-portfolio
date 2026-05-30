/**
 * Layout for the `(app)` route group (authenticated screens).
 *
 * Registers the shared {@link GlobalHeader} as the stack header so every
 * authenticated screen gets a consistent, platform-aware header. Screens set
 * their header title via the `title` navigation option.
 */
import { Stack } from 'expo-router';
import { GlobalHeader } from '../../src/components';

/**
 * Stack navigator for authenticated routes, using the global header.
 *
 * @returns A {@link Stack} whose header renders {@link GlobalHeader}.
 */
export default function AppLayout(): React.JSX.Element {
  return (
    <Stack
      screenOptions={{
        header: ({ options, navigation, back }) => (
          <GlobalHeader
            title={options.title ?? ''}
            showBackButton={back !== undefined}
            onBackPress={navigation.goBack}
          />
        ),
      }}
    />
  );
}
