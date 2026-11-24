import { describe, it, expect, beforeEach } from 'vitest';
import {
  signCallToken,
  verifyCallToken,
  signRoomToken,
  verifyRoomToken,
  messageTooLarge,
  fieldWithinLimit,
  allowSignalingMessage,
  allowMessagePerConnection,
  generateTurnCredentials,
  sanitizeSignalingMessage,
  relayAllowed,
  canJoinRoom,
  MAX_SIGNALING_MESSAGE_BYTES,
  MAX_SIGNALING_MESSAGES_PER_WINDOW,
  SIGNALING_RATE_WINDOW_MS,
  ROOM_TOKEN_TTL_SECONDS,
  CALL_TOKEN_TTL_SECONDS,
  DEFAULT_TURN_CREDENTIAL_TTL_SECONDS,
} from '../signaling-policy';

const TEST_SECRET = 'test-secret-for-unit-tests';

describe('signaling-policy', () => {
  describe('signCallToken & verifyCallToken', () => {
    it('should sign and verify a valid call token', () => {
      const claims = {
        userId: 'user-123',
        callId: 'room-456',
        peerId: 'peer-789',
      };
      
      const token = signCallToken(claims, TEST_SECRET);
      const verified = verifyCallToken(token, TEST_SECRET);
      
      expect(verified).not.toBeNull();
      expect(verified?.userId).toBe(claims.userId);
      expect(verified?.callId).toBe(claims.callId);
      expect(verified?.peerId).toBe(claims.peerId);
    });

    it('should reject a token with wrong secret', () => {
      const claims = {
        userId: 'user-123',
        callId: 'room-456',
        peerId: 'peer-789',
      };
      
      const token = signCallToken(claims, TEST_SECRET);
      const verified = verifyCallToken(token, 'wrong-secret');
      
      expect(verified).toBeNull();
    });

    it('should reject a malformed token', () => {
      expect(verifyCallToken('not-a-token', TEST_SECRET)).toBeNull();
      expect(verifyCallToken('partially.valid', TEST_SECRET)).toBeNull();
      expect(verifyCallToken('a.b.c', TEST_SECRET)).toBeNull();
    });

    it('should reject an expired token', () => {
      const claims = {
        userId: 'user-123',
        callId: 'room-456',
        peerId: 'peer-789',
      };
      
      // Sign with past expiry
      const now = Date.now();
      const payload = {
        ...claims,
        exp: Math.floor(now / 1000) - 100, // expired 100s ago
      };
      const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const sig = require('crypto').createHmac('sha256', TEST_SECRET).update(body).digest('base64url');
      const expiredToken = `${body}.${sig}`;
      
      const verified = verifyCallToken(expiredToken, TEST_SECRET);
      expect(verified).toBeNull();
    });
  });

  describe('signRoomToken & verifyRoomToken', () => {
    it('should sign and verify a valid room token', () => {
      const claims = {
        roomId: 'room-123',
        userId: 'user-456',
      };
      
      const token = signRoomToken(claims, TEST_SECRET);
      const verified = verifyRoomToken(token, TEST_SECRET);
      
      expect(verified).not.toBeNull();
      expect(verified?.roomId).toBe(claims.roomId);
      expect(verified?.userId).toBe(claims.userId);
    });

    it('should reject an expired room token', () => {
      const claims = {
        roomId: 'room-123',
        userId: 'user-456',
      };
      
      const now = Date.now();
      const payload = {
        ...claims,
        exp: Math.floor(now / 1000) - 100,
      };
      const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const sig = require('crypto').createHmac('sha256', TEST_SECRET).update(body).digest('base64url');
      const expiredToken = `${body}.${sig}`;
      
      const verified = verifyRoomToken(expiredToken, TEST_SECRET);
      expect(verified).toBeNull();
    });
  });

  describe('messageTooLarge', () => {
    it('should reject messages larger than limit', () => {
      expect(messageTooLarge(MAX_SIGNALING_MESSAGE_BYTES + 1)).toBe(true);
    });

    it('should accept messages at or below limit', () => {
      expect(messageTooLarge(MAX_SIGNALING_MESSAGE_BYTES)).toBe(false);
      expect(messageTooLarge(1)).toBe(false);
    });
  });

  describe('fieldWithinLimit', () => {
    it('should accept null/undefined values', () => {
      expect(fieldWithinLimit(null)).toBe(true);
      expect(fieldWithinLimit(undefined)).toBe(true);
    });

    it('should accept short strings', () => {
      expect(fieldWithinLimit('short')).toBe(true);
    });

    it('should reject strings longer than limit', () => {
      const longString = 'x'.repeat(MAX_SIGNALING_MESSAGE_BYTES + 1);
      expect(fieldWithinLimit(longString)).toBe(false);
    });
  });

  describe('allowSignalingMessage', () => {
    it('should allow messages within rate limit', () => {
      const timestamps: number[] = [];
      
      // First message should be allowed
      const result1 = allowSignalingMessage(timestamps);
      expect(result1.allowed).toBe(true);
      expect(result1.timestamps.length).toBe(1);
      
      // Second message should also be allowed
      const result2 = allowSignalingMessage(result1.timestamps);
      expect(result2.allowed).toBe(true);
      expect(result2.timestamps.length).toBe(2);
    });

    it('should reject messages when rate limit exceeded', () => {
      const timestamps: number[] = [];
      const now = Date.now();
      
      // Fill up to the limit
      for (let i = 0; i < MAX_SIGNALING_MESSAGES_PER_WINDOW; i++) {
        const result = allowSignalingMessage(timestamps, now + i * 100);
        expect(result.allowed).toBe(true);
        expect(result.timestamps.length).toBe(i + 1);
        timestamps.push(result.timestamps[result.timestamps.length - 1]);
      }
      
      // Next message should be rejected
      const result = allowSignalingMessage(timestamps, now + MAX_SIGNALING_MESSAGES_PER_WINDOW * 100);
      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it('should expire old timestamps', () => {
      const now = Date.now();
      const oldTimestamp = now - SIGNALING_RATE_WINDOW_MS - 1000; // 1 second too old
      
      const timestamps = [oldTimestamp];
      const result = allowSignalingMessage(timestamps, now);
      
      // Old timestamp should be filtered out, allowing the new message
      expect(result.allowed).toBe(true);
      expect(result.timestamps.length).toBe(1);
    });
  });

  describe('allowMessagePerConnection', () => {
    it('should allow messages within per-connection rate limit', () => {
      const timestamps: number[] = [];
      
      // First message should be allowed
      const result1 = allowMessagePerConnection(timestamps);
      expect(result1.allowed).toBe(true);
    });

    it('should enforce per-connection rate limit', () => {
      const timestamps: number[] = [];
      const now = Date.now();
      
      // Fill up to the limit (100 messages)
      for (let i = 0; i < 100; i++) {
        const result = allowMessagePerConnection(timestamps, now + i * 100);
        expect(result.allowed).toBe(true);
        timestamps.push(result.timestamps[result.timestamps.length - 1]);
      }
      
      // Next message should be rejected
      const result = allowMessagePerConnection(timestamps, now + 100 * 100);
      expect(result.allowed).toBe(false);
    });
  });

  describe('generateTurnCredentials', () => {
    it('should generate valid TURN credentials', () => {
      const peerId = 'peer-123';
      const credentials = generateTurnCredentials(peerId, TEST_SECRET, 3600); // 1 hour
      
      expect(credentials.username).toContain(peerId);
      expect(credentials.username).toContain(':'); // Format: expiry:peerId
      expect(credentials.credential).toBeDefined();
      expect(credentials.expiresAt).toBeGreaterThan(Date.now() / 1000);
    });

    it('should generate unique credentials per peer', () => {
      const cred1 = generateTurnCredentials('peer-1', TEST_SECRET, 3600);
      const cred2 = generateTurnCredentials('peer-2', TEST_SECRET, 3600);
      
      expect(cred1.username).not.toBe(cred2.username);
      expect(cred1.credential).not.toBe(cred2.credential);
    });
  });

  describe('sanitizeSignalingMessage', () => {
    it('should sanitize SDP with private IPs', () => {
      const msg = {
        type: 'offer',
        sdp: 'v=0\r\no=- 123456 789 IN IP4 192.168.1.100\r\n',
      };
      
      const sanitized = sanitizeSignalingMessage(msg);
      expect(sanitized).not.toBeNull();
      expect(sanitized?.sdp).not.toContain('192.168.1.100');
      expect(sanitized?.sdp).toContain('0.0.0.0');
    });

    it('should sanitize ICE candidates with private IPs', () => {
      const msg = {
        type: 'ice',
        candidate: 'candidate:1 1 udp 2122260223 192.168.1.100 54321 typ host',
      };
      
      const sanitized = sanitizeSignalingMessage(msg);
      expect(sanitized).not.toBeNull();
      expect(sanitized?.candidate).not.toContain('192.168.1.100');
      expect(sanitized?.candidate).toContain('0.0.0.0');
    });

    it('should reject messages with invalid type', () => {
      const msg = {
        type: 'invalid-type',
      };
      
      expect(sanitizeSignalingMessage(msg)).toBeNull();
    });

    it('should preserve allowed fields', () => {
      const msg = {
        type: 'offer',
        roomId: 'room-123',
        to: 'peer-456',
        sdp: 'v=0\r\n',
        candidate: null,
        amount: '100',
        asset: 'XLM',
      };
      
      const sanitized = sanitizeSignalingMessage(msg);
      expect(sanitized).not.toBeNull();
      expect(sanitized?.type).toBe('offer');
      expect(sanitized?.roomId).toBe('room-123');
      expect(sanitized?.to).toBe('peer-456');
      expect(sanitized?.sdp).toBe('v=0\r\n');
      expect(sanitized?.amount).toBe('100');
      expect(sanitized?.asset).toBe('XLM');
    });
  });

  describe('relayAllowed', () => {
    it('should allow relay within same room', () => {
      expect(relayAllowed('room-123', 'room-123')).toBe(true);
    });

    it('should reject relay between different rooms', () => {
      expect(relayAllowed('room-123', 'room-456')).toBe(false);
    });

    it('should reject relay when sender not in room', () => {
      expect(relayAllowed(null, 'room-123')).toBe(false);
      expect(relayAllowed(undefined, 'room-123')).toBe(false);
    });
  });

  describe('canJoinRoom', () => {
    it('should reject without token', () => {
      const result = canJoinRoom(null, 'room-123', TEST_SECRET);
      expect(result.allowed).toBe(false);
      expect(result.message).toBe('Room membership token required');
    });

    it('should reject invalid token', () => {
      const result = canJoinRoom('invalid-token', 'room-123', TEST_SECRET);
      expect(result.allowed).toBe(false);
    });

    it('should reject token for wrong room', () => {
      const token = signRoomToken({ roomId: 'other-room', userId: 'user-123' }, TEST_SECRET);
      const result = canJoinRoom(token, 'room-123', TEST_SECRET);
      expect(result.allowed).toBe(false);
      expect(result.message).toBe('Room token does not match target room');
    });

    it('should accept valid token for matching room', () => {
      const token = signRoomToken({ roomId: 'room-123', userId: 'user-123' }, TEST_SECRET);
      const result = canJoinRoom(token, 'room-123', TEST_SECRET);
      expect(result.allowed).toBe(true);
      expect(result.userId).toBe('user-123');
    });
  });
});
