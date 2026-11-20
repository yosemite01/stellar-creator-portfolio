/**
 * GET  /api/signaling  — Returns ICE server configuration (STUN/TURN credentials)
 * POST /api/signaling  — HTTP fallback for SDP offer/answer relay
 *
 * Call membership is a short-lived HMAC token bound to userId + callId + peerId.
 * The standalone WebSocket server (server/realtime/signaling.ts) checks the same
 * token. Messages are dropped when they exceed 16KB or 50 messages / 10s, and
 * a relay is delivered only to a peer in the same room.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import { getServerSession } from '@/lib/auth/auth';
import {
  DEFAULT_TURN_CREDENTIAL_TTL_SECONDS,
  signCallToken,
  signalingTokenSecret,
  generateTurnCredentials,
} from '@/server/realtime/signaling-policy';
import { requireAuth } from '@/server/services/authorization';

const MAX_PEERS_PER_ROOM = parseInt(process.env.MAX_PEERS_PER_ROOM ?? '2', 10);

const peerOwners = new Map<string, { userId: string; lastSeen: number }>();
const roomMembers = new Map<string, Map<string, number>>();
const peerRooms = new Map<string, string>();

const TURN_SECRET = process.env.TURN_SECRET ?? 'insecure-dev-secret';
const TURN_HOST = process.env.TURN_HOST ?? 'turn.example.com';
const TURN_PORT = parseInt(process.env.TURN_PORT ?? '3478', 10);
const TURN_TLS_PORT = parseInt(process.env.TURN_TLS_PORT ?? '5349', 10);
const STUN_URL = process.env.STUN_URL ?? 'stun:stun.l.google.com:19302';
const TURN_CREDENTIAL_TTL = parseInt(
  process.env.TURN_CREDENTIAL_TTL ?? String(DEFAULT_TURN_CREDENTIAL_TTL_SECONDS),
  10,
);

interface SignalingEntry {
  type: string;
  sdp?: string;
  candidate?: RTCIceCandidateInit;
  peerId: string;
  ts: number;
  amount?: string;
  asset?: string;
}

const signalingStore = new Map<string, SignalingEntry[]>();

const STORE_TTL_MS = 5 * 60 * 1000;
setInterval(() => {
  const cutoff = Date.now() - STORE_TTL_MS;
  for (const [key, entries] of signalingStore) {
    const fresh = entries.filter((e) => e.ts > cutoff);
    if (fresh.length === 0) signalingStore.delete(key);
    else signalingStore.set(key, fresh);
  }
  for (const [peerId, owner] of peerOwners) {
    if (owner.lastSeen <= cutoff) {
      peerOwners.delete(peerId);
      peerRooms.delete(peerId);
    }
  }
  for (const [roomId, members] of roomMembers) {
    for (const [userId, lastSeen] of members) {
      if (lastSeen <= cutoff) members.delete(userId);
    }
    if (members.size === 0) roomMembers.delete(roomId);
  }
}, 60_000).unref?.();

interface RTCIceCandidateInit {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
}

function generateIceServers(peerId: string) {
  const credentials = generateTurnCredentials(peerId, TURN_SECRET, TURN_CREDENTIAL_TTL);
  
  return [
    { urls: STUN_URL },
    { urls: `turn:${TURN_HOST}:${TURN_PORT}`, username: credentials.username, credential: credentials.credential },
    { urls: `turn:${TURN_HOST}:${TURN_PORT}?transport=tcp`, username: credentials.username, credential: credentials.credential },
    { urls: `turns:${TURN_HOST}:${TURN_TLS_PORT}`, username: credentials.username, credential: credentials.credential },
  ];
}

function issueCallToken(userId: string, callId: string, peerId: string) {
  return signCallToken({ userId, callId, peerId }, signalingTokenSecret());
}

/**
 * GET /api/signaling?peerId=<id>&roomId=<id>
 * Returns ICE servers and a call token bound to that room.
 *
 * GET /api/signaling?roomId=<id>&peerId=<id>&since=<ts>
 * Polls for inbound signaling messages (HTTP fallback for mobile clients).
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession();
  const user = requireAuth({ user: session?.user });

  const roomId = req.nextUrl.searchParams.get('roomId');
  const sinceParam = req.nextUrl.searchParams.get('since');
  const peerIdParam = req.nextUrl.searchParams.get('peerId');
  const isPoll = Boolean(roomId && peerIdParam && sinceParam !== null);

  if (isPoll && roomId && peerIdParam) {
    if (!claimPeerId(peerIdParam, user.id)) {
      return NextResponse.json(
        { error: 'peerId is already registered to another user' },
        { status: 403 },
      );
    }
    if (!claimRoomMembership(roomId, user.id, peerIdParam)) {
      return NextResponse.json({ error: 'Room is full' }, { status: 403 });
    }

    const since = Number(sinceParam);
    const key = `${roomId}:${peerIdParam}`;
    const entries = signalingStore.get(key) ?? [];
    const messages = entries.filter((entry) => entry.ts > since && entry.peerId !== peerIdParam);

    return NextResponse.json({
      messages,
      callToken: issueCallToken(user.id, roomId, peerIdParam),
    });
  }

  const peerId = peerIdParam ?? `${user.id}-${Date.now().toString(36)}`;
  if (!claimPeerId(peerId, user.id)) {
    return NextResponse.json(
      { error: 'peerId is already registered to another user' },
      { status: 403 },
    );
  }

  const callToken = roomId ? issueCallToken(user.id, roomId, peerId) : undefined;
  if (roomId && !claimRoomMembership(roomId, user.id, peerId)) {
    return NextResponse.json({ error: 'Room is full' }, { status: 403 });
  }

  return NextResponse.json({
    iceServers: generateIceServers(peerId),
    signalingWsUrl: process.env.NEXT_PUBLIC_SIGNALING_URL ?? 'ws://localhost:3001',
    peerId,
    ...(callToken ? { callToken } : {}),
  });
}

/**
 * POST /api/signaling
 *
 * HTTP fallback relay. Requires the call token from GET, and only stores a
 * message for a peer that has joined the same room.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession();
  const user = requireAuth({ user: session?.user });

  try {
    const raw = await req.text();
    
    // Check message size limit
    const byteLength = Buffer.byteLength(raw, 'utf8');
    if (byteLength > 16 * 1024) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }

    const body = JSON.parse(raw) as {
      roomId?: string;
      peerId?: string;
      type?: string;
      sdp?: string;
      candidate?: RTCIceCandidateInit;
      to?: string;
      amount?: string;
      asset?: string;
      token?: string;
    };
    const { roomId, peerId, type, sdp, candidate, to, amount, asset, token } = body;

    if (!roomId || !peerId || !type) {
      return NextResponse.json(
        { error: 'Missing required fields: roomId, peerId, type' },
        { status: 400 },
      );
    }

    // Check individual field sizes
    if ((typeof sdp === 'string' && sdp.length > 16 * 1024) || 
        (candidate !== undefined && JSON.stringify(candidate).length > 16 * 1024)) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }

    const claims = token ? verifyCallToken(token, signalingTokenSecret()) : null;
    if (!claims || claims.userId !== user.id || claims.callId !== roomId || claims.peerId !== peerId) {
      return NextResponse.json({ error: 'Invalid call token' }, { status: 401 });
    }

    if (!claimPeerId(peerId, user.id)) {
      return NextResponse.json(
        { error: 'peerId is already registered to another user' },
        { status: 403 },
      );
    }
    if (!claimRoomMembership(roomId, user.id, peerId)) {
      return NextResponse.json({ error: 'Room is full' }, { status: 403 });
    }

    if (to && !relayAllowed(roomId, peerRooms.get(to))) {
      return NextResponse.json({ error: 'Peer is not in this room' }, { status: 403 });
    }

    // Rate limiting (user-level)
    if (!checkRateLimit(user.id)) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    const key = to ? `${roomId}:${to}` : roomId;
    const existing = signalingStore.get(key) ?? [];
    existing.push({ type, sdp, candidate, peerId, ts: Date.now(), amount, asset });
    signalingStore.set(key, existing);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// ── Helper Functions ──────────────────────────────────────────────────────────

function claimPeerId(peerId: string, userId: string): boolean {
  const owner = peerOwners.get(peerId);
  if (owner === undefined) {
    peerOwners.set(peerId, { userId, lastSeen: Date.now() });
    return true;
  }
  if (owner.userId !== userId) return false;
  owner.lastSeen = Date.now();
  return true;
}

function claimRoomMembership(roomId: string, userId: string, peerId: string): boolean {
  let members = roomMembers.get(roomId);
  if (!members) {
    members = new Map();
    roomMembers.set(roomId, members);
  }
  if (!members.has(userId) && members.size >= MAX_PEERS_PER_ROOM) return false;
  members.set(userId, Date.now());
  peerRooms.set(peerId, roomId);
  return true;
}

// Rate limiting - simple counter based
const rateLimits = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_WINDOW_MS = 10_000; // 10 seconds
const RATE_LIMIT_MAX = 50; // 50 messages per window

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const existing = rateLimits.get(userId);
  
  if (!existing || now - existing.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimits.set(userId, { count: 1, windowStart: now });
    return true;
  }
  
  if (existing.count >= RATE_LIMIT_MAX) {
    return false;
  }
  
  existing.count++;
  return true;
}

// Import from signaling-policy (re-exported)
import { relayAllowed, verifyCallToken } from '@/server/realtime/signaling-policy';
