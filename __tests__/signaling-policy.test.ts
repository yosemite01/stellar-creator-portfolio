import { describe, it, expect } from 'vitest';
import {
  MAX_SIGNALING_MESSAGE_BYTES,
  MAX_SIGNALING_MESSAGES_PER_WINDOW,
  allowSignalingMessage,
  messageTooLarge,
  relayAllowed,
  signCallToken,
  verifyCallToken,
} from '@/server/realtime/signaling-policy';

const SECRET = 'test-signaling-secret';

describe('signaling room isolation', () => {
  it('relays only when both peers are in the same room', () => {
    expect(relayAllowed('room-a', 'room-a')).toBe(true);
    expect(relayAllowed('room-a', 'room-b')).toBe(false);
    expect(relayAllowed('room-a', null)).toBe(false);
    expect(relayAllowed(null, 'room-a')).toBe(false);
  });

  it('drops messages larger than 16KB', () => {
    expect(messageTooLarge(MAX_SIGNALING_MESSAGE_BYTES)).toBe(false);
    expect(messageTooLarge(MAX_SIGNALING_MESSAGE_BYTES + 1)).toBe(true);
  });

  it('drops the 51st message inside a 10s window', () => {
    let timestamps: number[] = [];
    for (let i = 0; i < MAX_SIGNALING_MESSAGES_PER_WINDOW; i++) {
      const decision = allowSignalingMessage(timestamps, 1_000 + i);
      expect(decision.allowed).toBe(true);
      timestamps = decision.timestamps;
    }
    const blocked = allowSignalingMessage(timestamps, 1_000 + MAX_SIGNALING_MESSAGES_PER_WINDOW);
    expect(blocked.allowed).toBe(false);
  });

  it('rejects a tampered or expired call token', () => {
    const token = signCallToken(
      { userId: 'user-1', callId: 'call-1', peerId: 'peer-1' },
      SECRET,
      1_000_000,
    );
    expect(verifyCallToken(token, SECRET, 1_000_000)?.callId).toBe('call-1');
    expect(verifyCallToken(`${token}x`, SECRET, 1_000_000)).toBeNull();
    expect(verifyCallToken(token, SECRET, 1_000_000 + 60 * 60 * 1000 + 1)).toBeNull();
  });
});
