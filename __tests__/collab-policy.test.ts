// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import type { AddressInfo } from 'net';
import {
  COLLAB_TOKEN_TTL_SECONDS,
  authorizeCollabUpgrade,
  collabVerifyClient,
  signCollabToken,
  verifyCollabToken,
} from '@/server/realtime/collab-policy';

const SECRET = 'test-collab-secret';
const NOW = 1_000_000;
const ROOM = 'bounty-scope-abc123';

function tokenFor(roomId: string, nowMs = NOW, secret = SECRET) {
  return signCollabToken({ userId: 'user-1', roomId }, secret, nowMs);
}

describe('collab upgrade authorization', () => {
  it('rejects an upgrade with no token', () => {
    expect(authorizeCollabUpgrade(`/${ROOM}`, SECRET, NOW)).toMatchObject({ ok: false, status: 401 });
  });

  it('rejects a token signed with another secret or tampered with', () => {
    const forged = tokenFor(ROOM, NOW, 'someone-elses-secret');
    expect(authorizeCollabUpgrade(`/${ROOM}?token=${forged}`, SECRET, NOW)).toMatchObject({
      ok: false,
      status: 401,
    });
    const tampered = `${tokenFor(ROOM)}x`;
    expect(authorizeCollabUpgrade(`/${ROOM}?token=${tampered}`, SECRET, NOW)).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it('rejects an expired token', () => {
    const later = NOW + COLLAB_TOKEN_TTL_SECONDS * 1000 + 1;
    expect(verifyCollabToken(tokenFor(ROOM), SECRET, later)).toBeNull();
    expect(authorizeCollabUpgrade(`/${ROOM}?token=${tokenFor(ROOM)}`, SECRET, later)).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it('rejects a token issued for a different room', () => {
    const token = tokenFor('bounty-scope-other');
    expect(authorizeCollabUpgrade(`/${ROOM}?token=${token}`, SECRET, NOW)).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it('accepts a valid token for the room and exposes its userId', () => {
    const decision = authorizeCollabUpgrade(`/${ROOM}?token=${tokenFor(ROOM)}`, SECRET, NOW);
    expect(decision).toMatchObject({ ok: true, claims: { userId: 'user-1', roomId: ROOM } });
  });
});

describe('collab websocket server', () => {
  let wss: WebSocketServer;
  let base: string;

  beforeAll(async () => {
    wss = new WebSocketServer({ port: 0, host: '127.0.0.1', verifyClient: collabVerifyClient(SECRET) });
    await new Promise((resolve) => wss.once('listening', resolve));
    base = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((resolve) => wss.close(() => resolve())));

  function connect(path: string): Promise<{ opened: boolean; status?: number }> {
    return new Promise((resolve) => {
      const ws = new WebSocket(`${base}${path}`);
      ws.on('open', () => {
        ws.close();
        resolve({ opened: true });
      });
      ws.on('unexpected-response', (_req, res) => {
        res.resume();
        resolve({ opened: false, status: res.statusCode });
      });
      ws.on('error', () => undefined);
    });
  }

  it('answers an unauthenticated upgrade with HTTP 401 instead of upgrading', async () => {
    expect(await connect(`/${ROOM}`)).toEqual({ opened: false, status: 401 });
  });

  it('answers an expired token with HTTP 401', async () => {
    const expired = tokenFor(ROOM, Date.now() - (COLLAB_TOKEN_TTL_SECONDS + 5) * 1000);
    expect(await connect(`/${ROOM}?token=${expired}`)).toEqual({ opened: false, status: 401 });
  });

  it('answers another room\'s token with HTTP 403', async () => {
    const token = tokenFor('bounty-scope-other', Date.now());
    expect(await connect(`/${ROOM}?token=${token}`)).toEqual({ opened: false, status: 403 });
  });

  it('upgrades when the token is valid for the room', async () => {
    const token = tokenFor(ROOM, Date.now());
    expect(await connect(`/${ROOM}?token=${token}`)).toEqual({ opened: true });
  });
});
