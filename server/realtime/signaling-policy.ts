import { createHmac, timingSafeEqual } from 'crypto';

/** Drop signaling frames larger than this. SDP and ICE candidates fit well under it. */
export const MAX_SIGNALING_MESSAGE_BYTES = 16 * 1024;
export const MAX_SIGNALING_MESSAGES_PER_WINDOW = 50;
export const SIGNALING_RATE_WINDOW_MS = 10_000;
/** Call tokens and TURN credentials stay valid for one hour, then must be reissued. */
export const CALL_TOKEN_TTL_SECONDS = 60 * 60;
export const DEFAULT_TURN_CREDENTIAL_TTL_SECONDS = 60 * 60;

export interface CallTokenClaims {
  userId: string;
  callId: string;
  peerId: string;
  exp: number;
}

export function signalingTokenSecret(): string {
  return (
    process.env.SIGNALING_TOKEN_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.TURN_SECRET ||
    'insecure-dev-secret'
  );
}

export function signCallToken(
  claims: Omit<CallTokenClaims, 'exp'>,
  secret: string,
  nowMs = Date.now(),
): string {
  const payload: CallTokenClaims = {
    ...claims,
    exp: Math.floor(nowMs / 1000) + CALL_TOKEN_TTL_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyCallToken(
  token: string,
  secret: string,
  nowMs = Date.now(),
): CallTokenClaims | null {
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
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as CallTokenClaims;
    if (
      typeof claims.userId !== 'string' ||
      typeof claims.callId !== 'string' ||
      typeof claims.peerId !== 'string' ||
      typeof claims.exp !== 'number'
    ) {
      return null;
    }
    if (claims.exp * 1000 <= nowMs) return null;
    if (!claims.userId || !claims.callId || !claims.peerId) return null;
    return claims;
  } catch {
    return null;
  }
}

export function messageTooLarge(byteLength: number): boolean {
  return byteLength > MAX_SIGNALING_MESSAGE_BYTES;
}

export function fieldWithinLimit(value: unknown): boolean {
  if (value == null) return true;
  const encoded = typeof value === 'string' ? value : JSON.stringify(value);
  return Buffer.byteLength(encoded, 'utf8') <= MAX_SIGNALING_MESSAGE_BYTES;
}

/**
 * Sliding window: at most 50 signaling messages per 10 seconds.
 * The returned timestamps should be stored back on the connection.
 */
export function allowSignalingMessage(
  timestamps: number[],
  nowMs = Date.now(),
): { allowed: boolean; timestamps: number[] } {
  const fresh = timestamps.filter((ts) => nowMs - ts < SIGNALING_RATE_WINDOW_MS);
  if (fresh.length >= MAX_SIGNALING_MESSAGES_PER_WINDOW) {
    return { allowed: false, timestamps: fresh };
  }
  fresh.push(nowMs);
  return { allowed: true, timestamps: fresh };
}

/** A relay is allowed only when both peers are in the same call room. */
export function relayAllowed(
  senderRoomId: string | null | undefined,
  targetRoomId: string | null | undefined,
): boolean {
  return Boolean(senderRoomId) && senderRoomId === targetRoomId;
}
