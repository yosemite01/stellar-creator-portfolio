/**
 * Layout for the `(app)` route group (authenticated screens).
 *
 * Registers the shared {@link GlobalHeader} as the stack header so every
 * authenticated screen gets a consistent, platform-aware header. Screens set
 * their header title via the `title` navigation option.
 *
 * Also initializes WatermelonDB sync scheduler and displays sync status
 * indicator in the header.
 */
import { Stack } from 'expo-router';
import { useSession } from '../../src/ctx/auth';
import { GlobalHeader, SyncStatusIndicator } from '../../src/components';
import { useSyncScheduler } from '../../utils/SyncScheduler';

/**
 * Stack navigator for authenticated routes, using the global header with sync indicator.
 *
 * @returns A {@link Stack} whose header renders {@link GlobalHeader} with sync status.
 */
export default function AppLayout(): React.JSX.Element {
  const { session } = useSession();

  // Initialize sync scheduler
  const syncStatus = useSyncScheduler({
    apiBaseUrl: process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000',
    accessToken: session?.user?.token || '',
    syncIntervalMs: 30000, // 30 seconds
  });

  return (
    <Stack
      screenOptions={{
        header: ({ options, navigation, back }) => (
          <GlobalHeader
            title={options.title ?? ''}
            showBackButton={back !== undefined}
            onBackPress={navigation.goBack}
            rightAction={<SyncStatusIndicator status={syncStatus} />}
          />
        ),
      }}
    />
  );
}
