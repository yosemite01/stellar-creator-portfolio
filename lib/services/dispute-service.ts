/**
 * Dispute resolution domain layer — client-side persistence (localStorage).
 * Replace with API + DB when backend endpoints are ready.
 */

import { z } from 'zod';

// ── Zod schemas (validation) ─────────────────────────────────────────────────

export const disputeCategorySchema = z.enum([
  'payment',
  'delivery',
  'quality',
  'communication',
  'other',
]);
export type DisputeCategory = z.infer<typeof disputeCategorySchema>;

export const disputeStatusSchema = z.enum([
  'filed',
  'evidence',
  'mediation',
  'community_vote',
  'resolved',
  'appealed',
  'closed',
]);
export type DisputeStatus = z.infer<typeof disputeStatusSchema>;

export const fileDisputeInputSchema = z.object({
  title: z.string().min(8, 'Title must be at least 8 characters').max(200),
  description: z
    .string()
    .min(40, 'Please describe the issue in at least 40 characters')
    .max(8000),
  category: disputeCategorySchema,
  relatedOrderId: z.string().min(1, 'Order or project reference is required').max(120),
  counterpartyId: z.string().min(1, 'Counterparty user id is required').max(120),
  counterpartyName: z.string().min(1).max(200).optional(),
  escrowAmountCents: z.number().int().min(0).max(1_000_000_000).default(0),
});
export type FileDisputeInput = z.infer<typeof fileDisputeInputSchema>;

/** Form: dollars as string; map to cents before calling `fileDispute`. */
export const disputeFormInputSchema = fileDisputeInputSchema
  .omit({ escrowAmountCents: true })
  .extend({
    escrowDollars: z.string().optional().default(''),
  });
export type DisputeFormInput = z.infer<typeof disputeFormInputSchema>;

export function toFileDisputeInput(form: DisputeFormInput): FileDisputeInput {
  const raw = parseFloat(form.escrowDollars?.trim() || '0');
  const escrowAmountCents = Number.isFinite(raw)
    ? Math.min(1_000_000_000, Math.max(0, Math.round(raw * 100)))
    : 0;
  return fileDisputeInputSchema.parse({
    title: form.title,
    description: form.description,
    category: form.category,
    relatedOrderId: form.relatedOrderId,
    counterpartyId: form.counterpartyId,
    counterpartyName: form.counterpartyName,
    escrowAmountCents,
  });
}

export const evidenceMetadataSchema = z.object({
  fileName: z.string().min(1).max(500),
  mimeType: z.string().min(1).max(200),
  byteSize: z.number().int().min(1).max(25 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i, 'Invalid SHA-256 digest'),
  note: z.string().max(2000).optional(),
});
export type EvidenceMetadata = z.infer<typeof evidenceMetadataSchema>;

export const communityVoteSchema = z.object({
  userId: z.string().min(1),
  side: z.enum(['client', 'creator']),
});
export type CommunityVoteInput = z.infer<typeof communityVoteSchema>;

export const appealInputSchema = z.object({
  reason: z.string().min(20).max(4000),
});
export type AppealInput = z.infer<typeof appealInputSchema>;

// ── Types ────────────────────────────────────────────────────────────────────

export type UserRole = 'USER' | 'CLIENT' | 'CREATOR' | 'ADMIN';

export interface EvidenceItem extends EvidenceMetadata {
  id: string;
  submittedByUserId: string;
  submittedByLabel: string;
  submittedAt: string;
  /** Redacted preview only — binary stays local until upload API exists */
  caption?: string;
}

export type ResolutionOutcome =
  | 'favor_client'
  | 'favor_creator'
  | 'split'
  | 'dismissed';

export interface DisputeResolution {
  outcome: ResolutionOutcome;
  summary: string;
  templateId?: string;
  resolvedBy?: string;
  resolvedAt: string;
}

export interface DisputeAppeal {
  status: 'pending' | 'reviewed';
  reason: string;
  submittedAt: string;
  reviewedAt?: string;
  outcome?: 'upheld' | 'denied';
}

export interface DisputeRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  filedByUserId: string;
  filedByName: string;
  counterpartyId: string;
  counterpartyName: string;
  relatedOrderId: string;
  title: string;
  description: string;
  category: DisputeCategory;
  status: DisputeStatus;
  evidence: EvidenceItem[];
  mediationNotes: string[];
  assignedAdminId?: string;
  communityVotes: Array<{
    userId: string;
    side: 'client' | 'creator';
    castAt: string;
  }>;
  resolution?: DisputeResolution;
  appeal?: DisputeAppeal;
  escrow: {
    held: boolean;
    amountCents: number;
    holdStartedAt?: string;
    releasedAt?: string;
  };
  timeline: Array<{ at: string; message: string }>;
  preventionTags: string[];
}

export interface DisputeResolutionTemplate {
  id: string;
  label: string;
  outcome: ResolutionOutcome;
  body: string;
}

export const DISPUTE_RESOLUTION_TEMPLATES: DisputeResolutionTemplate[] = [
  {
    id: 'tpl_release_client',
    label: 'Release escrow to client (non-delivery)',
    outcome: 'favor_client',
    body: 'After review, deliverables were incomplete or not provided per agreement. Escrow is released to the client; the creator may appeal with additional evidence.',
  },
  {
    id: 'tpl_release_creator',
    label: 'Release escrow to creator (work accepted)',
    outcome: 'favor_creator',
    body: 'Deliverables met the agreed scope. Escrow is released to the creator. The client may appeal only with new material evidence.',
  },
  {
    id: 'tpl_split',
    label: 'Partial refund / split',
    outcome: 'split',
    body: 'Both parties contributed to the issue. A partial split of escrow is applied per platform policy. Details were communicated to both sides.',
  },
  {
    id: 'tpl_dismiss',
    label: 'Dismiss — no policy breach',
    outcome: 'dismissed',
    body: 'No breach of platform terms was found. Parties are encouraged to continue work or cancel per contract. Escrow handling follows the original milestone rules.',
  },
];

const STORAGE_KEY = 'stellar_disputes_v1';

export interface DisputeStoreSnapshot {
  disputes: DisputeRecord[];
}

const seedDisputes: DisputeRecord[] = [
  {
    id: 'dsp_seed_1',
    createdAt: '2026-03-20T10:00:00.000Z',
    updatedAt: '2026-03-21T14:00:00.000Z',
    filedByUserId: 'u5',
    filedByName: 'Marcus Webb',
    counterpartyId: 'u1',
    counterpartyName: 'Alex Chen',
    relatedOrderId: 'ord_demo_001',
    title: 'Milestone delivery incomplete',
    description:
      'The second milestone was marked complete but key assets described in the scope were not delivered. I have requested revisions with no response for 5 business days.',
    category: 'delivery',
    status: 'mediation',
    evidence: [],
    mediationNotes: ['Admin invited both parties to upload dated screenshots.'],
    assignedAdminId: 'admin',
    communityVotes: [],
    escrow: { held: true, amountCents: 150000, holdStartedAt: '2026-03-20T10:05:00.000Z' },
    timeline: [
      { at: '2026-03-20T10:00:00.000Z', message: 'Dispute filed; escrow hold requested.' },
      { at: '2026-03-20T10:05:00.000Z', message: 'Escrow hold active for $1,500.00.' },
      { at: '2026-03-21T14:00:00.000Z', message: 'Mediation started by admin.' },
    ],
    preventionTags: ['late_milestone'],
  },
];

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 12)}_${Date.now().toString(36)}`;
}

/** SHA-256 hex digest for evidence integrity (browser + Node test env). */
export async function hashEvidenceBytes(buf: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('Web Crypto is not available');
  }
  const digest = await subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function parseFileDisputeInput(raw: unknown): FileDisputeInput {
  return fileDisputeInputSchema.parse(raw);
}

export function parseEvidenceMetadata(raw: unknown): EvidenceMetadata {
  return evidenceMetadataSchema.parse(raw);
}

function loadSnapshot(): DisputeStoreSnapshot {
  if (typeof window === 'undefined') {
    return { disputes: [...seedDisputes] };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const initial: DisputeStoreSnapshot = { disputes: [...seedDisputes] };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
      return initial;
    }
    const parsed = JSON.parse(raw) as DisputeStoreSnapshot;
    if (!parsed?.disputes || !Array.isArray(parsed.disputes)) {
      return { disputes: [...seedDisputes] };
    }
    return parsed;
  } catch {
    return { disputes: [...seedDisputes] };
  }
}

function saveSnapshot(s: DisputeStoreSnapshot): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export function getDisputeSnapshot(): DisputeStoreSnapshot {
  return loadSnapshot();
}

export function replaceDisputeSnapshotForTests(snapshot: DisputeStoreSnapshot): void {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  }
}

export function clearDisputeStorageForTests(): void {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}

function pushTimeline(d: DisputeRecord, message: string): void {
  d.timeline.push({ at: nowIso(), message });
  d.updatedAt = nowIso();
}

export function listDisputesForUser(userId: string): DisputeRecord[] {
  const { disputes } = loadSnapshot();
  return disputes.filter(
    (d) => d.filedByUserId === userId || d.counterpartyId === userId
  );
}

export function canViewDispute(
  userId: string,
  role: UserRole,
  d: DisputeRecord
): boolean {
  if (role === 'ADMIN') return true;
  return d.filedByUserId === userId || d.counterpartyId === userId;
}

export function canSubmitEvidence(
  userId: string,
  d: DisputeRecord
): boolean {
  if (d.status === 'resolved' || d.status === 'closed') return false;
  return d.filedByUserId === userId || d.counterpartyId === userId;
}

export function fileDispute(
  input: FileDisputeInput,
  filedBy: { userId: string; name: string }
): DisputeRecord {
  const parsed = fileDisputeInputSchema.parse(input);
  const snap = loadSnapshot();
  const d: DisputeRecord = {
    id: newId('dsp'),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    filedByUserId: filedBy.userId,
    filedByName: filedBy.name,
    counterpartyId: parsed.counterpartyId,
    counterpartyName: parsed.counterpartyName ?? 'Counterparty',
    relatedOrderId: parsed.relatedOrderId,
    title: parsed.title,
    description: parsed.description,
    category: parsed.category,
    status: 'filed',
    evidence: [],
    mediationNotes: [],
    communityVotes: [],
    escrow: {
      held: parsed.escrowAmountCents > 0,
      amountCents: parsed.escrowAmountCents,
      holdStartedAt:
        parsed.escrowAmountCents > 0 ? nowIso() : undefined,
    },
    timeline: [],
    preventionTags: inferPreventionTags(parsed.category, parsed.description),
  };
  pushTimeline(d, 'Dispute filed.');
  if (d.escrow.held) {
    pushTimeline(
      d,
      `Escrow hold active for ${(d.escrow.amountCents / 100).toFixed(2)} (simulated).`
    );
    d.status = 'evidence';
  } else {
    d.status = 'evidence';
    pushTimeline(d, 'No escrow amount linked — proceed with evidence only.');
  }
  snap.disputes = [d, ...snap.disputes];
  saveSnapshot(snap);
  return d;
}

function inferPreventionTags(
  category: DisputeCategory,
  description: string
): string[] {
  const tags: string[] = [];
  const lower = description.toLowerCase();
  if (category === 'payment' || lower.includes('pay')) tags.push('payment_risk');
  if (lower.includes('deadline') || lower.includes('late')) tags.push('timeline');
  if (lower.includes('scope') || lower.includes('revision')) tags.push('scope_creep');
  return tags;
}

export function addEvidence(
  disputeId: string,
  meta: EvidenceMetadata,
  submittedBy: { userId: string; label: string }
): DisputeRecord {
  evidenceMetadataSchema.parse(meta);
  const snap = loadSnapshot();
  const d = snap.disputes.find((x) => x.id === disputeId);
  if (!d) throw new Error('Dispute not found');
  if (!canSubmitEvidence(submittedBy.userId, d)) {
    throw new Error('Not allowed to submit evidence for this dispute');
  }
  const item: EvidenceItem = {
    ...meta,
    id: newId('ev'),
    submittedByUserId: submittedBy.userId,
    submittedByLabel: submittedBy.label,
    submittedAt: nowIso(),
  };
  d.evidence.push(item);
  pushTimeline(d, `Evidence uploaded: ${meta.fileName} (SHA-256 recorded).`);
  if (d.status === 'filed') d.status = 'evidence';
  saveSnapshot(snap);
  return d;
}

export function startMediation(
  disputeId: string,
  adminId: string,
  note?: string
): DisputeRecord {
  const snap = loadSnapshot();
  const d = snap.disputes.find((x) => x.id === disputeId);
  if (!d) throw new Error('Dispute not found');
  d.assignedAdminId = adminId;
  d.status = 'mediation';
  if (note) d.mediationNotes.push(note);
  pushTimeline(d, 'Mediation started by admin.');
  saveSnapshot(snap);
  return d;
}

export function openCommunityVote(disputeId: string): DisputeRecord {
  const snap = loadSnapshot();
  const d = snap.disputes.find((x) => x.id === disputeId);
  if (!d) throw new Error('Dispute not found');
  d.status = 'community_vote';
  pushTimeline(d, 'Community review window opened (advisory votes).');
  saveSnapshot(snap);
  return d;
}

export function castCommunityVote(
  disputeId: string,
  vote: CommunityVoteInput,
  voterRole: UserRole
): DisputeRecord {
  communityVoteSchema.parse(vote);
  if (voterRole !== 'USER' && voterRole !== 'CLIENT' && voterRole !== 'CREATOR') {
    throw new Error('Only community members may vote');
  }
  const snap = loadSnapshot();
  const d = snap.disputes.find((x) => x.id === disputeId);
  if (!d) throw new Error('Dispute not found');
  if (d.status !== 'community_vote') {
    throw new Error('Community vote is not open for this dispute');
  }
  if (vote.userId === d.filedByUserId || vote.userId === d.counterpartyId) {
    throw new Error('Parties to the dispute cannot vote');
  }
  const existing = d.communityVotes.some((v) => v.userId === vote.userId);
  if (existing) throw new Error('Already voted');
  d.communityVotes.push({
    userId: vote.userId,
    side: vote.side,
    castAt: nowIso(),
  });
  pushTimeline(d, `Community vote recorded (${vote.side}).`);
  saveSnapshot(snap);
  return d;
}

export function resolveDisputeWithTemplate(
  disputeId: string,
  templateId: string,
  adminName: string,
  extraSummary?: string
): DisputeRecord {
  const tpl = DISPUTE_RESOLUTION_TEMPLATES.find((t) => t.id === templateId);
  if (!tpl) throw new Error('Unknown template');
  const snap = loadSnapshot();
  const d = snap.disputes.find((x) => x.id === disputeId);
  if (!d) throw new Error('Dispute not found');
  if (d.status === 'closed') throw new Error('Dispute already closed');

  const summary = extraSummary ? `${tpl.body}\n\n${extraSummary}` : tpl.body;
  d.resolution = {
    outcome: tpl.outcome,
    summary,
    templateId: tpl.id,
    resolvedBy: adminName,
    resolvedAt: nowIso(),
  };
  d.status = 'resolved';
  if (d.escrow.held) {
    d.escrow.releasedAt = nowIso();
    pushTimeline(
      d,
      'Escrow hold released per resolution (simulated settlement).'
    );
  }
  pushTimeline(d, `Resolved using template: ${tpl.label}.`);
  saveSnapshot(snap);
  return d;
}

export function submitAppeal(
  disputeId: string,
  input: AppealInput,
  submittedByUserId: string
): DisputeRecord {
  appealInputSchema.parse(input);
  const snap = loadSnapshot();
  const d = snap.disputes.find((x) => x.id === disputeId);
  if (!d) throw new Error('Dispute not found');
  if (d.status !== 'resolved') {
    throw new Error('Appeals are only accepted after a resolution');
  }
  if (d.appeal?.status === 'pending') {
    throw new Error('An appeal is already pending');
  }
  if (
    submittedByUserId !== d.filedByUserId &&
    submittedByUserId !== d.counterpartyId
  ) {
    throw new Error('Only dispute parties may appeal');
  }
  d.appeal = {
    status: 'pending',
    reason: input.reason,
    submittedAt: nowIso(),
  };
  d.status = 'appealed';
  if (d.escrow.held || d.escrow.amountCents > 0) {
    d.escrow.held = true;
    d.escrow.holdStartedAt = d.escrow.holdStartedAt ?? nowIso();
    pushTimeline(d, 'Escrow hold reinstated pending appeal review.');
  }
  pushTimeline(d, 'Appeal submitted.');
  saveSnapshot(snap);
  return d;
}

export function closeDispute(disputeId: string): DisputeRecord {
  const snap = loadSnapshot();
  const d = snap.disputes.find((x) => x.id === disputeId);
  if (!d) throw new Error('Dispute not found');
  d.status = 'closed';
  pushTimeline(d, 'Dispute closed.');
  saveSnapshot(snap);
  return d;
}

// ── Analytics & prevention ───────────────────────────────────────────────────

export interface DisputeAnalytics {
  totalOpen: number;
  inMediation: number;
  awaitingCommunity: number;
  resolvedLast30d: number;
  averageEvidenceCount: number;
  topCategories: Array<{ category: DisputeCategory; count: number }>;
  preventionFlags: Record<string, number>;
}

export function computeDisputeAnalytics(
  disputes: DisputeRecord[]
): DisputeAnalytics {
  const openStatuses: DisputeStatus[] = [
    'filed',
    'evidence',
    'mediation',
    'community_vote',
    'appealed',
  ];
  const totalOpen = disputes.filter((d) => openStatuses.includes(d.status)).length;
  const inMediation = disputes.filter((d) => d.status === 'mediation').length;
  const awaitingCommunity = disputes.filter(
    (d) => d.status === 'community_vote'
  ).length;
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const resolvedLast30d = disputes.filter((d) => {
    if (d.status !== 'resolved' && d.status !== 'closed') return false;
    const t = d.resolution?.resolvedAt ?? d.updatedAt;
    return new Date(t).getTime() >= thirtyDaysAgo;
  }).length;
  const evCount =
    disputes.reduce((acc, d) => acc + d.evidence.length, 0) /
    Math.max(1, disputes.length);
  const catMap = new Map<DisputeCategory, number>();
  for (const d of disputes) {
    catMap.set(d.category, (catMap.get(d.category) ?? 0) + 1);
  }
  const topCategories = [...catMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category, count]) => ({ category, count }));
  const preventionFlags: Record<string, number> = {};
  for (const d of disputes) {
    for (const t of d.preventionTags) {
      preventionFlags[t] = (preventionFlags[t] ?? 0) + 1;
    }
  }
  return {
    totalOpen,
    inMediation,
    awaitingCommunity,
    resolvedLast30d,
    averageEvidenceCount: Math.round(evCount * 10) / 10,
    topCategories,
    preventionFlags,
  };
}

export function verifyEvidenceDigest(
  meta: EvidenceMetadata,
  fileBytes: ArrayBuffer
): Promise<boolean> {
  return hashEvidenceBytes(fileBytes).then((h) => h.toLowerCase() === meta.sha256.toLowerCase());
}
