import jwt from 'jsonwebtoken';
import { getJwtSecret } from '@/server/api/jwt-secret';

/** Access tokens are short-lived; the app refreshes them with the refresh token. */
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface MobileSession {
  accessToken: string;
  refreshToken: string;
  /** Access token lifetime in seconds. */
  expiresIn: number;
}

/**
 * Issue tokens for the mobile app. The access token carries `userId`, which is
 * what `createContext` in server/api/trpc.ts verifies for Bearer requests.
 */
export async function issueMobileSession(userId: string): Promise<MobileSession> {
  const secret = getJwtSecret();
  const accessToken = jwt.sign({ userId, typ: 'access' }, secret, {
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });
  const refreshToken = jwt.sign({ userId, typ: 'refresh' }, secret, {
    expiresIn: REFRESH_TOKEN_TTL_SECONDS,
  });
  return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}
