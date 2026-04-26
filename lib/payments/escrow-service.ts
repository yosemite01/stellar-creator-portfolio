/**
 * Bounty escrow state machine (Stripe PaymentIntents with `capture_method: manual`).
 * Funds are authorized then captured on release, or cancelled/refunded.
 * In-memory store suitable for demo; persist to DB for production.
 */

export type EscrowStatus =
  | 'pending_funding'
  | 'funded_authorized'
  | 'released'
  | 'refunded'
  | 'failed'

export interface EscrowRecord {
  id: string
  bountyId: string
  clientUserId: string
  freelancerUserId?: string
  amountCents: number
  currency: string
  /** Platform fee in minor units (e.g. cents). */
  platformFeeCents: number
  paymentIntentId?: string
  status: EscrowStatus
  receiptUrl?: string
  failureMessage?: string
  createdAt: string
  updatedAt: string
}

type Store = {
  escrows: Map<string, EscrowRecord>
  byPaymentIntent: Map<string, string>
}

function getStore(): Store {
  const g = globalThis as unknown as { __escrowStore?: Store }
  if (!g.__escrowStore) {
    g.__escrowStore = {
      escrows: new Map(),
      byPaymentIntent: new Map(),
    }
  }
  return g.__escrowStore
}

function nowIso(): string {
  return new Date().toISOString()
}

/** Default platform fee: 10% of bounty amount (basis points style via integer math). */
export function computePlatformFeeCents(amountCents: number, feeBps: number = 1000): number {
  if (amountCents <= 0) return 0
  return Math.round((amountCents * feeBps) / 10000)
}

export function computeFreelancerPayoutCents(amountCents: number, platformFeeCents: number): number {
  return Math.max(0, amountCents - platformFeeCents)
}

export function createEscrow(params: {
  bountyId: string
  clientUserId: string
  amountCents: number
  currency?: string
  feeBps?: number
}): EscrowRecord {
  const currency = (params.currency ?? 'usd').toLowerCase()
  const platformFeeCents = computePlatformFeeCents(params.amountCents, params.feeBps ?? 1000)
  const id = crypto.randomUUID()
  const ts = nowIso()
  const record: EscrowRecord = {
    id,
    bountyId: params.bountyId,
    clientUserId: params.clientUserId,
    amountCents: params.amountCents,
    currency,
    platformFeeCents,
    status: 'pending_funding',
    createdAt: ts,
    updatedAt: ts,
  }
  getStore().escrows.set(id, record)
  return record
}

export function getEscrow(id: string): EscrowRecord | undefined {
  return getStore().escrows.get(id)
}

export function attachPaymentIntent(escrowId: string, paymentIntentId: string): EscrowRecord | null {
  const store = getStore()
  const e = store.escrows.get(escrowId)
  if (!e) return null
  e.paymentIntentId = paymentIntentId
  e.updatedAt = nowIso()
  store.byPaymentIntent.set(paymentIntentId, escrowId)
  return e
}

export function findEscrowByPaymentIntent(paymentIntentId: string): EscrowRecord | undefined {
  const id = getStore().byPaymentIntent.get(paymentIntentId)
  if (!id) return undefined
  return getStore().escrows.get(id)
}

export function markFundedAuthorized(escrowId: string, receiptUrl?: string): EscrowRecord | null {
  const e = getStore().escrows.get(escrowId)
  if (!e) return null
  e.status = 'funded_authorized'
  e.receiptUrl = receiptUrl ?? e.receiptUrl
  e.updatedAt = nowIso()
  return e
}

export function markReleased(escrowId: string, receiptUrl?: string): EscrowRecord | null {
  const e = getStore().escrows.get(escrowId)
  if (!e) return null
  e.status = 'released'
  e.receiptUrl = receiptUrl ?? e.receiptUrl
  e.updatedAt = nowIso()
  return e
}

export function markRefunded(escrowId: string): EscrowRecord | null {
  const e = getStore().escrows.get(escrowId)
  if (!e) return null
  e.status = 'refunded'
  e.updatedAt = nowIso()
  return e
}

export function markFailed(escrowId: string, message?: string): EscrowRecord | null {
  const e = getStore().escrows.get(escrowId)
  if (!e) return null
  e.status = 'failed'
  e.failureMessage = message
  e.updatedAt = nowIso()
  return e
}

export function listEscrowsForUser(userId: string): EscrowRecord[] {
  return Array.from(getStore().escrows.values())
    .filter((e) => e.clientUserId === userId || e.freelancerUserId === userId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

export function __resetEscrowStoreForTests(): void {
  const g = globalThis as unknown as { __escrowStore?: Store }
  g.__escrowStore = {
    escrows: new Map(),
    byPaymentIntent: new Map(),
  }
}
