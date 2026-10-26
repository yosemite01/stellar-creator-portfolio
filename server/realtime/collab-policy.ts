import { createHmac, timingSafeEqual } from 'crypto';
import type { IncomingMessage } from 'http';

/**
 * Collab tokens are short-lived on purpose: membership is only checked when
 * one is issued, so a revoked member is out within a minute of the next
 * reconnect.
 */
export const COLLAB_TOKEN_TTL_SECONDS = 60;

export interface CollabTokenClaims {
  userId: string;
  roomId: string;
  exp: number;
}

export function collabTokenSecret(): string {
  const secret = process.env.REALTIME_JWT_SECRET || process.env.NEXTAUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('REALTIME_JWT_SECRET must be set in production');
  }
  return 'insecure-dev-secret';
}

export function signCollabToken(
  claims: Omit<CollabTokenClaims, 'exp'>,
  secret: string,
  nowMs = Date.now(),
): string {
  const payload: CollabTokenClaims = {
    ...claims,
    exp: Math.floor(nowMs / 1000) + COLLAB_TOKEN_TTL_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyCollabToken(
  token: string,
  secret: string,
  nowMs = Date.now(),
): CollabTokenClaims | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const actualBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
    return null;
  }

  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as CollabTokenClaims;
    if (
      typeof claims.userId !== 'string' ||
      typeof claims.roomId !== 'string' ||
      typeof claims.exp !== 'number'
    ) {
      return null;
    }
    if (claims.exp * 1000 <= nowMs) return null;
    if (!claims.userId || !claims.roomId) return null;
    return claims;
  } catch {
    return null;
  }
}

/** The room is the URL path (`/<docName>`); the query string carries the token. */
export function roomFromUrl(rawUrl: string | undefined): string {
  const path = (rawUrl ?? '/').split('?')[0].replace(/^\//, '');
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

export type UpgradeDecision =
  | { ok: true; claims: CollabTokenClaims }
  | { ok: false; status: 401 | 403; message: string };

/**
 * Decide whether a websocket upgrade may proceed. Deny by default: the caller
 * needs a valid, unexpired token that was issued for the room in the URL.
 */
export function authorizeCollabUpgrade(
  rawUrl: string | undefined,
  secret: string,
  nowMs = Date.now(),
): UpgradeDecision {
  let token: string | null = null;
  try {
    token = new URL(rawUrl ?? '/', 'http://127.0.0.1').searchParams.get('token');
  } catch {
    // malformed request target: treated the same as a missing token
  }
  if (!token) return { ok: false, status: 401, message: 'Unauthorized' };

  const claims = verifyCollabToken(token, secret, nowMs);
  if (!claims) return { ok: false, status: 401, message: 'Unauthorized' };

  if (claims.roomId !== roomFromUrl(rawUrl)) {
    return { ok: false, status: 403, message: 'Forbidden' };
  }
  return { ok: true, claims };
}

export type CollabRequest = IncomingMessage & { collabClaims?: CollabTokenClaims };

/**
 * `verifyClient` hook for the `ws` server. A rejection is answered with a
 * plain HTTP 401/403 before the upgrade completes, so no socket is opened.
 */
export function collabVerifyClient(secret: string) {
  return (
    info: { req: IncomingMessage },
    done: (result: boolean, code?: number, message?: string) => void,
  ): void => {
    const decision = authorizeCollabUpgrade(info.req.url, secret);
    if (!decision.ok) return done(false, decision.status, decision.message);
    (info.req as CollabRequest).collabClaims = decision.claims;
    done(true);
  };
}
