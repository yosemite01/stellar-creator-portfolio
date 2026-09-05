import { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { AuthFlowNavigator } from '../../src/screens/AuthFlowNavigator';
import { ROUTES } from '../../src/constants/routes';

export default function LoginRoute() {
  const router = useRouter();

  // NOTE: intentionally not calling useAuthStore().setUser() here. Doing so
  // needs a real User record + session token, and neither exists yet - the
  // Google auth path (src/hooks/useGoogleAuth.ts) returns a user record with
  // no session token the rest of the app can use, and the wallet flow this
  // component replaced never issued one either. Until that backend piece
  // lands, this only navigates the current session into the app; a restart
  // correctly bounces back to login rather than persisting a fake session.
  const handleAuthComplete = useCallback(
    (_publicKey: string) => {
      router.replace(ROUTES.APP.HOME);
    },
    [router],
  );

  return <AuthFlowNavigator onAuthComplete={handleAuthComplete} />;
}
