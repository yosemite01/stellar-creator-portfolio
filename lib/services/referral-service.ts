import crypto from 'crypto';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReferralStatus = 'pending' | 'converted' | 'rewarded' | 'flagged';
export type ReferralEventType = 'signup' | 'first_project' | 'first_hire';

export interface ReferralCode {
  code: string;
  userId: string;
  createdAt: Date;
  uses: number;
}

export interface ReferralRecord {
  id: string;
  referrerId: string;
  referredUserId: string;
  code: string;
  status: ReferralStatus;
  event: ReferralEventType;
  rewardAmount: number;   // USD cents
  ipAddress: string;
  createdAt: Date;
  convertedAt?: Date;
  rewardedAt?: Date;
}

export interface ReferralStats {
  totalReferrals: number;
  converted: number;
  pending: number;
  totalEarned: number;   // USD cents
  pendingPayout: number; // USD cents
}

// ─── Reward table (USD cents) ─────────────────────────────────────────────────

const REWARDS: Record<ReferralEventType, number> = {
  signup:        500,   // $5
  first_project: 2000,  // $20
  first_hire:    3000,  // $30
};

// ─── In-memory store (swap for DB calls in production) ───────────────────────

const codes   = new Map<string, ReferralCode>();
const records = new Map<string, ReferralRecord>();

// Fraud prevention: track IP → referral attempts within a window
const ipAttempts = new Map<string, { count: number; windowStart: number }>();
const FRAUD_WINDOW_MS  = 60 * 60 * 1000; // 1 hour
const FRAUD_MAX_SIGNUPS = 3;

// ─── Code generation ──────────────────────────────────────────────────────────

export function generateReferralCode(userId: string): ReferralCode {
  const existing = getUserCode(userId);
  if (existing) return existing;

  const code = crypto
    .createHash('sha256')
    .update(`${userId}-${Date.now()}`)
    .digest('base64url')
    .slice(0, 8)
    .toUpperCase();

  const record: ReferralCode = { code, userId, createdAt: new Date(), uses: 0 };
  codes.set(code, record);
  return record;
}

export function getUserCode(userId: string): ReferralCode | null {
  for (const c of codes.values()) {
    if (c.userId === userId) return c;
  }
  return null;
}

export function resolveCode(code: string): ReferralCode | null {
  return codes.get(code.toUpperCase()) ?? null;
}

// ─── Fraud prevention ─────────────────────────────────────────────────────────

function checkFraud(ipAddress: string): boolean {
  const now = Date.now();
  const entry = ipAttempts.get(ipAddress);

  if (!entry || now - entry.windowStart > FRAUD_WINDOW_MS) {
    ipAttempts.set(ipAddress, { count: 1, windowStart: now });
    return false; // not fraud
  }

  entry.count++;
  return entry.count > FRAUD_MAX_SIGNUPS;
}

// ─── Tracking ─────────────────────────────────────────────────────────────────

export interface TrackReferralParams {
  code: string;
  referredUserId: string;
  event: ReferralEventType;
  ipAddress: string;
}

export type TrackResult =
  | { success: true;  record: ReferralRecord }
  | { success: false; reason: 'invalid_code' | 'self_referral' | 'duplicate' | 'fraud' };

export function trackReferral(params: TrackReferralParams): TrackResult {
  const { code, referredUserId, event, ipAddress } = params;

  const codeRecord = resolveCode(code);
  if (!codeRecord) return { success: false, reason: 'invalid_code' };

  // Self-referral guard
  if (codeRecord.userId === referredUserId) return { success: false, reason: 'self_referral' };

  // Duplicate guard: same referrer + referred + event
  for (const r of records.values()) {
    if (r.referrerId === codeRecord.userId && r.referredUserId === referredUserId && r.event === event) {
      return { success: false, reason: 'duplicate' };
    }
  }

  // Fraud guard
  if (checkFraud(ipAddress)) return { success: false, reason: 'fraud' };

  const id = crypto.randomUUID();
  const record: ReferralRecord = {
    id,
    referrerId:     codeRecord.userId,
    referredUserId,
    code,
    status:         'pending',
    event,
    rewardAmount:   REWARDS[event],
    ipAddress,
    createdAt:      new Date(),
  };

  records.set(id, record);
  codeRecord.uses++;

  return { success: true, record };
}

// ─── Conversion & payout ──────────────────────────────────────────────────────

export function convertReferral(referralId: string): ReferralRecord | null {
  const r = records.get(referralId);
  if (!r || r.status !== 'pending') return null;
  r.status      = 'converted';
  r.convertedAt = new Date();
  return r;
}

export function markRewarded(referralId: string): ReferralRecord | null {
  const r = records.get(referralId);
  if (!r || r.status !== 'converted') return null;
  r.status     = 'rewarded';
  r.rewardedAt = new Date();
  return r;
}

export function flagReferral(referralId: string): ReferralRecord | null {
  const r = records.get(referralId);
  if (!r) return null;
  r.status = 'flagged';
  return r;
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export function getReferralStats(userId: string): ReferralStats {
  const userRecords = [...records.values()].filter((r) => r.referrerId === userId);
  return {
    totalReferrals: userRecords.length,
    converted:      userRecords.filter((r) => r.status === 'converted' || r.status === 'rewarded').length,
    pending:        userRecords.filter((r) => r.status === 'pending').length,
    totalEarned:    userRecords.filter((r) => r.status === 'rewarded').reduce((s, r) => s + r.rewardAmount, 0),
    pendingPayout:  userRecords.filter((r) => r.status === 'converted').reduce((s, r) => s + r.rewardAmount, 0),
  };
}

export function getReferralHistory(userId: string): ReferralRecord[] {
  return [...records.values()]
    .filter((r) => r.referrerId === userId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export { REWARDS };
