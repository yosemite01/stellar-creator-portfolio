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

/**
 * Signaling token secret helper - Deprecated, use secrets.ts
 * 
 * @deprecated Use getSecretValue('SIGNALING_TOKEN_SECRET') from @/server/services/secrets instead
 */
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

// ── Room Membership Token (bound to roomId + userId) ─────────────────────────

export const ROOM_TOKEN_TTL_SECONDS = 60;

export interface RoomTokenClaims {
  roomId: string;
  userId: string;
  exp: number;
}

export function signRoomToken(
  claims: Omit<RoomTokenClaims, 'exp'>,
  secret: string = signalingTokenSecret(),
  nowMs = Date.now(),
): string {
  const payload: RoomTokenClaims = {
    ...claims,
    exp: Math.floor(nowMs / 1000) + ROOM_TOKEN_TTL_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyRoomToken(
  token: string,
  secret: string = signalingTokenSecret(),
  nowMs = Date.now(),
): RoomTokenClaims | null {
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
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as RoomTokenClaims;
    if (
      typeof claims.roomId !== 'string' ||
      typeof claims.userId !== 'string' ||
      typeof claims.exp !== 'number'
    ) {
      return null;
    }
    if (claims.exp * 1000 <= nowMs) return null;
    if (!claims.roomId || !claims.userId) return null;
    return claims;
  } catch {
    return null;
  }
}

// ── Message Size Limits ──────────────────────────────────────────────────────

export function messageTooLarge(byteLength: number): boolean {
  return byteLength > MAX_SIGNALING_MESSAGE_BYTES;
}

export function fieldWithinLimit(value: unknown): boolean {
  if (value == null) return true;
  const encoded = typeof value === 'string' ? value : JSON.stringify(value);
  return Buffer.byteLength(encoded, 'utf8') <= MAX_SIGNALING_MESSAGE_BYTES;
}

// ── Rate Limiting ────────────────────────────────────────────────────────────

export interface RateLimitResult {
  allowed: boolean;
  timestamps: number[];
  retryAfter: number;
}

/**
 * Sliding window: at most 50 signaling messages per 10 seconds.
 * The returned timestamps should be stored back on the connection.
 */
export function allowSignalingMessage(
  timestamps: number[],
  nowMs = Date.now(),
): RateLimitResult {
  const fresh = timestamps.filter((ts) => nowMs - ts < SIGNALING_RATE_WINDOW_MS);
  if (fresh.length >= MAX_SIGNALING_MESSAGES_PER_WINDOW) {
    const oldestInWindow = fresh[0];
    const retryAfter = Math.ceil((oldestInWindow + SIGNALING_RATE_WINDOW_MS - nowMs) / 1000);
    return { allowed: false, timestamps: fresh, retryAfter };
  }
  fresh.push(nowMs);
  return { allowed: true, timestamps: fresh, retryAfter: 0 };
}

/** Maximum messages per window for per-connection limits. */
export const MAX_MESSAGES_PER_CONNECTION_PER_WINDOW = 100;

/**
 * Per-connection rate limit with stricter limits to prevent abuse.
 * This is separate from user-level rate limiting to prevent one user
 * from exhausting limits for all users on the same connection.
 */
export function allowMessagePerConnection(
  timestamps: number[],
  nowMs = Date.now(),
): RateLimitResult {
  const fresh = timestamps.filter((ts) => nowMs - ts < SIGNALING_RATE_WINDOW_MS);
  if (fresh.length >= MAX_MESSAGES_PER_CONNECTION_PER_WINDOW) {
    const oldestInWindow = fresh[0];
    const retryAfter = Math.ceil((oldestInWindow + SIGNALING_RATE_WINDOW_MS - nowMs) / 1000);
    return { allowed: false, timestamps: fresh, retryAfter };
  }
  fresh.push(nowMs);
  return { allowed: true, timestamps: fresh, retryAfter: 0 };
}

// ── TURN Credentials (short-lived per user) ──────────────────────────────────

export interface TurnCredentials {
  username: string;
  credential: string;
  expiresAt: number;
}

export function generateTurnCredentials(
  peerId: string,
  secret: string = process.env.TURN_SECRET ?? 'insecure-dev-secret',
  ttlSeconds: number = DEFAULT_TURN_CREDENTIAL_TTL_SECONDS,
): TurnCredentials {
  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
  const username = `${expiry}:${peerId}`;
  const credential = createHmac('sha1', secret)
    .update(username)
    .digest('base64');
  return {
    username,
    credential,
    expiresAt: expiry,
  };
}

// ── Message Fuzzing / Sanitization ───────────────────────────────────────────

/**
 * Fuzz a signaling message to remove private IP addresses and validate structure.
 * Returns null if the message is unsafe or malformed.
 *
 * This prevents SDP/ICE payloads from leaking private IPs (RFC 8489 § 5.1.2).
 */
export function sanitizeSignalingMessage(
  msg: Record<string, unknown>,
): Record<string, unknown> | null {
  // Validate basic structure
  if (typeof msg !== 'object' || msg === null) {
    return null;
  }

  // Only allow known message types
  const allowedTypes = new Set(['join', 'offer', 'answer', 'ice', 'leave', 'ping', 'pong']);
  if (typeof msg.type !== 'string' || !allowedTypes.has(msg.type)) {
    return null;
  }

  // Validate roomId if present
  if (typeof msg.roomId === 'string' && msg.roomId.length > 128) {
    return null;
  }

  // Validate peerId if present
  if (typeof msg.peerId === 'string' && msg.peerId.length > 64) {
    return null;
  }

  // Validate "to" field if present
  if (typeof msg.to === 'string' && msg.to.length > 64) {
    return null;
  }

  // Fuzz SDP to remove private IP addresses
  if (typeof msg.sdp === 'string') {
    const sanitizedSdp = sanitizeSdp(msg.sdp);
    if (sanitizedSdp === null) {
      return null;
    }
    msg.sdp = sanitizedSdp;
  }

  // Fuzz ICE candidate to remove private IP addresses
  if (typeof msg.candidate === 'string') {
    const sanitizedCandidate = sanitizeIceCandidate(msg.candidate);
    if (sanitizedCandidate === null) {
      return null;
    }
    msg.candidate = sanitizedCandidate;
  }

  // Remove any unexpected fields
  const sanitized: Record<string, unknown> = {
    type: msg.type,
  };

  if (typeof msg.roomId === 'string') sanitized.roomId = msg.roomId;
  if (typeof msg.peerId === 'string') sanitized.peerId = msg.peerId;
  if (typeof msg.to === 'string') sanitized.to = msg.to;
  if (typeof msg.sdp === 'string') sanitized.sdp = msg.sdp;
  if (typeof msg.candidate === 'string') sanitized.candidate = msg.candidate;
  if (typeof msg.amount === 'string') sanitized.amount = msg.amount;
  if (typeof msg.asset === 'string') sanitized.asset = msg.asset;

  return sanitized;
}

/**
 * Sanitize SDP to remove private IP addresses.
 * Based on RFC 8489 § 5.1.2 (IP Address Handling).
 */
function sanitizeSdp(sdp: string): string | null {
  try {
    // Limit SDP size
    if (sdp.length > MAX_SIGNALING_MESSAGE_BYTES) {
      return null;
    }

    // Basic SDP validation - must contain mandatory fields
    if (!sdp.includes('v=') || !sdp.includes('o=')) {
      return null;
    }

    // Remove private IP addresses
    // IPv4 private ranges: 10.x.x.x, 172.16.x.x-172.31.x.x, 192.168.x.x
    // IPv6 unique local: fc00::/7
    const sanitized = sdp
      .replace(/\b(10|172\.(1[6-9]|2[0-9]|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b/g, '0.0.0.0')
      .replace(/\b(fc[0-9a-fA-F]{2}:[0-9a-fA-F:]+)\b/g, '::1')
      .replace(/\b(localhost|127\.0\.0\.1)\b/g, '0.0.0.0');

    return sanitized;
  } catch {
    return null;
  }
}

/**
 * Sanitize ICE candidate to remove private IP addresses.
 * Based on RFC 8489 § 5.1.2.
 */
function sanitizeIceCandidate(candidate: string): string | null {
  try {
    // Limit candidate size
    if (candidate.length > 512) {
      return null;
    }

    // Basic candidate format validation
    if (!candidate.includes('candidate:') || !candidate.includes('udp') || !candidate.includes('rel')) {
      // Allow rtcp candidate types too
      if (!candidate.includes('candidate:') || !candidate.includes('udp')) {
        return null;
      }
    }

    // Remove private IP addresses
    const sanitized = candidate
      .replace(/\b(10|172\.(1[6-9]|2[0-9]|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b/g, '0.0.0.0')
      .replace(/\b(fc[0-9a-fA-F]{2}:[0-9a-fA-F:]+)\b/g, '::1')
      .replace(/\b(localhost|127\.0\.0\.1)\b/g, '0.0.0.0');

    return sanitized;
  } catch {
    return null;
  }
}

// ── Relay Validation ─────────────────────────────────────────────────────────

/**
 * A relay is allowed only when both peers are in the same call room.
 * The sender must have a valid room membership token for the target room.
 */
export function relayAllowed(
  senderRoomId: string | null | undefined,
  targetRoomId: string | null | undefined,
): boolean {
  return Boolean(senderRoomId) && senderRoomId === targetRoomId;
}

/**
 * Check if a user can join a room using a room token.
 * This prevents non-members from joining rooms.
 */
export function canJoinRoom(
  token: string | null | undefined,
  roomId: string,
  secret: string = signalingTokenSecret(),
  nowMs = Date.now(),
): { allowed: boolean; userId?: string; message?: string } {
  if (!token) {
    return { allowed: false, message: 'Room membership token required' };
  }

  const claims = verifyRoomToken(token, secret, nowMs);
  if (!claims) {
    return { allowed: false, message: 'Invalid or expired room token' };
  }

  if (claims.roomId !== roomId) {
    return { allowed: false, message: 'Room token does not match target room' };
  }

  return { allowed: true, userId: claims.userId };
}
