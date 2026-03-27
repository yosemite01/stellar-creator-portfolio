import { getBountyById, type Bounty } from '@/lib/creators-data'

export type ApplicationStatus = 'pending' | 'accepted' | 'rejected'

export interface BountyApplicationRecord {
  id: string
  bountyId: string
  applicantId: string
  applicantName: string
  applicantEmail: string
  proposedBudget: number
  timelineDays: number
  proposal: string
  status: ApplicationStatus
  createdAt: string
  updatedAt: string
}

export interface TimelineEntry {
  id: string
  applicationId: string
  bountyId: string
  type: 'submitted' | 'status_changed' | 'message'
  label: string
  detail?: string
  actorId?: string
  actorName?: string
  meta?: Record<string, string>
  createdAt: string
}

export interface ApplicationThreadMessage {
  id: string
  applicationId: string
  bountyId: string
  senderId: string
  senderName: string
  senderEmail: string
  body: string
  createdAt: string
}

export interface BountyNotificationRecord {
  id: string
  userId: string
  title: string
  body: string
  read: boolean
  applicationId?: string
  bountyId?: string
  createdAt: string
}

type Store = {
  applications: BountyApplicationRecord[]
  timeline: TimelineEntry[]
  messages: ApplicationThreadMessage[]
  notifications: BountyNotificationRecord[]
}

function getGlobalStore(): Store {
  const g = globalThis as unknown as { __bountyApplicationStore?: Store }
  if (!g.__bountyApplicationStore) {
    g.__bountyApplicationStore = {
      applications: [],
      timeline: [],
      messages: [],
      notifications: [],
    }
  }
  return g.__bountyApplicationStore
}

function nowIso(): string {
  return new Date().toISOString()
}

export function clientCanManageBounty(
  userId: string,
  role: string,
  bounty: Bounty,
): boolean {
  if (role === 'ADMIN') return true
  if (role !== 'CLIENT') return false
  if (bounty.ownerUserId == null || bounty.ownerUserId === '') return true
  return bounty.ownerUserId === userId
}

export function creatorOwnsApplication(
  applicantId: string,
  role: string,
  application: BountyApplicationRecord,
): boolean {
  if (role === 'ADMIN') return true
  if (role !== 'CREATOR') return false
  return application.applicantId === applicantId
}

export function canViewApplication(
  userId: string,
  role: string,
  application: BountyApplicationRecord,
  bounty: Bounty | undefined,
): boolean {
  if (!bounty) return false
  if (role === 'ADMIN') return true
  if (application.applicantId === userId) return true
  if (role === 'CLIENT' && clientCanManageBounty(userId, role, bounty)) return true
  return false
}

export function submitApplication(params: {
  bountyId: string
  applicantId: string
  applicantName: string
  applicantEmail: string
  proposedBudget: number
  timelineDays: number
  proposal: string
}): { application: BountyApplicationRecord } | { error: string } {
  const bounty = getBountyById(params.bountyId)
  if (!bounty) return { error: 'Bounty not found' }
  if (bounty.status !== 'open') return { error: 'This bounty is not accepting applications' }

  const store = getGlobalStore()
  const dup = store.applications.some(
    (a) => a.bountyId === params.bountyId && a.applicantId === params.applicantId,
  )
  if (dup) return { error: 'You have already applied to this bounty' }

  const id = crypto.randomUUID()
  const ts = nowIso()
  const application: BountyApplicationRecord = {
    id,
    bountyId: params.bountyId,
    applicantId: params.applicantId,
    applicantName: params.applicantName,
    applicantEmail: params.applicantEmail,
    proposedBudget: params.proposedBudget,
    timelineDays: params.timelineDays,
    proposal: params.proposal,
    status: 'pending',
    createdAt: ts,
    updatedAt: ts,
  }
  store.applications.push(application)

  const tId = crypto.randomUUID()
  store.timeline.push({
    id: tId,
    applicationId: id,
    bountyId: params.bountyId,
    type: 'submitted',
    label: 'Application submitted',
    detail: `${params.applicantName} submitted a proposal`,
    actorId: params.applicantId,
    actorName: params.applicantName,
    createdAt: ts,
  })

  return { application }
}

export function listApplicationsForBounty(bountyId: string): BountyApplicationRecord[] {
  return getGlobalStore().applications.filter((a) => a.bountyId === bountyId)
}

export function listApplicationsForApplicant(applicantId: string): BountyApplicationRecord[] {
  return getGlobalStore().applications.filter((a) => a.applicantId === applicantId)
}

export function getApplicationById(id: string): BountyApplicationRecord | undefined {
  return getGlobalStore().applications.find((a) => a.id === id)
}

export function getApplicantCountsForBounties(bountyIds: string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const id of bountyIds) counts[id] = 0
  for (const a of getGlobalStore().applications) {
    if (counts[a.bountyId] !== undefined) counts[a.bountyId]++
  }
  return counts
}

export function updateApplicationStatus(params: {
  applicationId: string
  status: ApplicationStatus
  actorId: string
  actorName: string
}): { application: BountyApplicationRecord } | { error: string } {
  const store = getGlobalStore()
  const idx = store.applications.findIndex((a) => a.id === params.applicationId)
  if (idx === -1) return { error: 'Application not found' }

  const bounty = getBountyById(store.applications[idx].bountyId)
  if (!bounty) return { error: 'Bounty not found' }

  const prev = store.applications[idx].status
  if (prev !== 'pending') {
    return { error: 'Only pending applications can be accepted or rejected' }
  }

  const ts = nowIso()
  const updated: BountyApplicationRecord = {
    ...store.applications[idx],
    status: params.status,
    updatedAt: ts,
  }
  store.applications[idx] = updated

  store.timeline.push({
    id: crypto.randomUUID(),
    applicationId: params.applicationId,
    bountyId: updated.bountyId,
    type: 'status_changed',
    label: `Application ${params.status}`,
    detail: `Status changed from ${prev} to ${params.status}`,
    actorId: params.actorId,
    actorName: params.actorName,
    meta: { from: prev, to: params.status },
    createdAt: ts,
  })

  return { application: updated }
}

export function getTimelineForApplication(applicationId: string): TimelineEntry[] {
  return getGlobalStore()
    .timeline.filter((t) => t.applicationId === applicationId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
}

export function getTimelineForBounty(bountyId: string): TimelineEntry[] {
  return getGlobalStore()
    .timeline.filter((t) => t.bountyId === bountyId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
}

export function addThreadMessage(params: {
  applicationId: string
  bountyId: string
  senderId: string
  senderName: string
  senderEmail: string
  body: string
}): { message: ApplicationThreadMessage } | { error: string } {
  const application = getApplicationById(params.applicationId)
  if (!application) return { error: 'Application not found' }
  if (application.bountyId !== params.bountyId) return { error: 'Invalid bounty for application' }

  const ts = nowIso()
  const message: ApplicationThreadMessage = {
    id: crypto.randomUUID(),
    applicationId: params.applicationId,
    bountyId: params.bountyId,
    senderId: params.senderId,
    senderName: params.senderName,
    senderEmail: params.senderEmail,
    body: params.body.trim(),
    createdAt: ts,
  }
  getGlobalStore().messages.push(message)

  getGlobalStore().timeline.push({
    id: crypto.randomUUID(),
    applicationId: params.applicationId,
    bountyId: params.bountyId,
    type: 'message',
    label: 'New message',
    detail: params.body.slice(0, 120),
    actorId: params.senderId,
    actorName: params.senderName,
    createdAt: ts,
  })

  return { message }
}

export function listThreadMessages(applicationId: string): ApplicationThreadMessage[] {
  return getGlobalStore()
    .messages.filter((m) => m.applicationId === applicationId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
}

export function pushNotification(n: Omit<BountyNotificationRecord, 'id' | 'createdAt' | 'read'>): BountyNotificationRecord {
  const record: BountyNotificationRecord = {
    ...n,
    id: crypto.randomUUID(),
    read: false,
    createdAt: nowIso(),
  }
  getGlobalStore().notifications.push(record)
  return record
}

export function listNotificationsForUser(userId: string): BountyNotificationRecord[] {
  return getGlobalStore()
    .notifications.filter((n) => n.userId === userId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export function markNotificationRead(notificationId: string, userId: string): boolean {
  const store = getGlobalStore()
  const n = store.notifications.find((x) => x.id === notificationId && x.userId === userId)
  if (!n) return false
  n.read = true
  return true
}

export function markAllNotificationsRead(userId: string): number {
  let n = 0
  for (const x of getGlobalStore().notifications) {
    if (x.userId === userId && !x.read) {
      x.read = true
      n++
    }
  }
  return n
}

/** Test helper: reset in-memory store (do not use in production routes except tests). */
export function __resetBountyStoreForTests(): void {
  const g = globalThis as unknown as { __bountyApplicationStore?: Store }
  g.__bountyApplicationStore = {
    applications: [],
    timeline: [],
    messages: [],
    notifications: [],
  }
}
