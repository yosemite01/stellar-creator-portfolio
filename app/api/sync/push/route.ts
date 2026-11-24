import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import type { ApplicationStatus, BountyStatus } from '@/lib/generated/prisma/client';

interface EntityChanges {
  created?: Record<string, unknown>[];
  updated?: Record<string, unknown>[];
  deleted?: string[];
}

interface PushPayload {
  changes: {
    bounties?: EntityChanges;
    applications?: EntityChanges;
    messages?: EntityChanges;
  };
  lastPulledAt?: number;
}

/**
 * Entity types the offline queue is allowed to push. Deny-by-default: any
 * entity key not in this allowlist causes the whole push to be rejected.
 */
const ALLOWED_ENTITY_TYPES = ['bounties', 'applications', 'messages'] as const;
type AllowedEntityType = (typeof ALLOWED_ENTITY_TYPES)[number];

const BOUNTY_STATUSES = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const satisfies readonly BountyStatus[];
const APPLICATION_STATUSES = ['PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'] as const satisfies readonly ApplicationStatus[];

class ValidationError extends Error {}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`Invalid or missing field: ${field}`);
  }
  return value;
}

function requireNumber(value: unknown, field: string): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) {
    throw new ValidationError(`Invalid or missing field: ${field}`);
  }
  return num;
}

function requireDate(value: unknown, field: string): Date {
  const date = new Date(value as string | number | Date);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError(`Invalid or missing field: ${field}`);
  }
  return date;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function optionalStatus<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new ValidationError(`Invalid status: ${String(value)}`);
  }
  return value as T;
}

function optionalTags(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every((tag) => typeof tag === 'string')) {
    throw new ValidationError('Invalid field: tags');
  }
  return value;
}

function validateBountyCreate(record: Record<string, unknown>) {
  return {
    id: optionalString(record.id) ?? undefined,
    title: requireString(record.title, 'title'),
    description: requireString(record.description, 'description'),
    budget: requireNumber(record.budget, 'budget'),
    deadline: requireDate(record.deadline, 'deadline'),
    status: optionalStatus(record.status, BOUNTY_STATUSES, 'OPEN'),
    category: optionalString(record.category),
    tags: optionalTags(record.tags),
  };
}

function validateBountyUpdate(record: Record<string, unknown>) {
  return {
    title: requireString(record.title, 'title'),
    description: requireString(record.description, 'description'),
    budget: requireNumber(record.budget, 'budget'),
    deadline: requireDate(record.deadline, 'deadline'),
    status: optionalStatus(record.status, BOUNTY_STATUSES, 'OPEN'),
    category: optionalString(record.category),
    tags: optionalTags(record.tags),
  };
}

function validateApplicationCreate(record: Record<string, unknown>) {
  return {
    id: optionalString(record.id) ?? undefined,
    bountyId: requireString(record.bounty_id, 'bounty_id'),
    proposal: requireString(record.proposal, 'proposal'),
    proposedBudget: requireNumber(record.proposed_budget, 'proposed_budget'),
    timeline: requireNumber(record.timeline_days, 'timeline_days'),
    status: optionalStatus(record.status, APPLICATION_STATUSES, 'PENDING'),
  };
}

function validateApplicationUpdate(record: Record<string, unknown>) {
  return {
    proposal: requireString(record.proposal, 'proposal'),
    proposedBudget: requireNumber(record.proposed_budget, 'proposed_budget'),
    timeline: requireNumber(record.timeline_days, 'timeline_days'),
    status: optionalStatus(record.status, APPLICATION_STATUSES, 'PENDING'),
  };
}

function validateEntityChanges(entityType: AllowedEntityType, changes: unknown): EntityChanges {
  if (!isPlainObject(changes)) {
    throw new ValidationError(`Invalid changes for entity: ${entityType}`);
  }

  const result: EntityChanges = {};

  for (const bucket of ['created', 'updated'] as const) {
    const records = changes[bucket];
    if (records === undefined) continue;
    if (!Array.isArray(records) || !records.every(isPlainObject)) {
      throw new ValidationError(`Invalid ${bucket} records for entity: ${entityType}`);
    }
    result[bucket] = records as Record<string, unknown>[];
  }

  const deleted = changes.deleted;
  if (deleted !== undefined) {
    if (!Array.isArray(deleted) || !deleted.every((id) => typeof id === 'string' && id.trim() !== '')) {
      throw new ValidationError(`Invalid deleted ids for entity: ${entityType}`);
    }
    result.deleted = deleted as string[];
  }

  return result;
}

function validatePayload(payload: unknown): PushPayload {
  if (!isPlainObject(payload)) {
    throw new ValidationError('Invalid payload');
  }

  const changes = payload.changes;
  if (!isPlainObject(changes)) {
    throw new ValidationError('Missing changes object');
  }

  // Deny-by-default: reject any entity type we do not explicitly support.
  for (const key of Object.keys(changes)) {
    if (!(ALLOWED_ENTITY_TYPES as readonly string[]).includes(key)) {
      throw new ValidationError(`Unsupported entity type: ${key}`);
    }
  }

  const validated: PushPayload = { changes: {} };
  for (const entityType of ALLOWED_ENTITY_TYPES) {
    if (changes[entityType] !== undefined) {
      validated.changes[entityType] = validateEntityChanges(entityType, changes[entityType]);
    }
  }

  if (payload.lastPulledAt !== undefined) {
    validated.lastPulledAt = requireNumber(payload.lastPulledAt, 'lastPulledAt');
  }

  return validated;
}

/**
 * POST /api/sync/push
 *
 * Applies client changes to server database using server-wins conflict resolution.
 * If server record updated_at > client record updated_at, ignores client change.
 *
 * Conflict policy (see #1625): server-wins on tie; client changes are only
 * applied when strictly newer than the server record. Deletes are soft
 * (status transitions) and only applied to records owned by the caller.
 *
 * Ownership: every created record is stamped with the caller's id; every
 * update/delete is rejected unless the caller owns the existing record.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const userId = session.user.id;

    let payload: PushPayload;
    try {
      payload = validatePayload(await req.json());
    } catch (error) {
      if (error instanceof ValidationError) {
        return NextResponse.json(
          { error: 'Invalid sync payload', details: error.message },
          { status: 400 }
        );
      }
      throw error;
    }

    const { changes } = payload;

    // Process bounty changes (only allow creator to update/delete)
    if (changes.bounties) {
      // Created bounties
      for (const bounty of changes.bounties.created || []) {
        const data = validateBountyCreate(bounty);
        await prisma.bounty.create({
          data: {
            ...data,
            creatorId: userId,
          },
        });
      }

      // Updated bounties - server-wins: check if server version is newer
      for (const bounty of changes.bounties.updated || []) {
        const bountyId = requireString(bounty.id, 'id');
        const serverBounty = await prisma.bounty.findUnique({
          where: { id: bountyId },
        });

        // Ownership check: reject writes to records the caller does not own.
        if (!serverBounty || serverBounty.creatorId !== userId) {
          return NextResponse.json(
            { error: 'Forbidden: cannot modify record you do not own' },
            { status: 403 }
          );
        }

        const serverUpdated = serverBounty.updatedAt.getTime();
        const clientUpdated = new Date(bounty.updated_at as string | number | Date).getTime();

        // Only update if client is newer (server-wins on tie)
        if (clientUpdated > serverUpdated) {
          await prisma.bounty.update({
            where: { id: bountyId },
            data: validateBountyUpdate(bounty),
          });
        } else if (process.env.DEBUG) {
          logger.debug('Conflict: skipping bounty (server is newer)', { bountyId });
        }
      }

      // Deleted bounties (soft delete via status)
      for (const bountyId of changes.bounties.deleted || []) {
        const bounty = await prisma.bounty.findUnique({
          where: { id: bountyId },
        });

        if (!bounty || bounty.creatorId !== userId) {
          return NextResponse.json(
            { error: 'Forbidden: cannot modify record you do not own' },
            { status: 403 }
          );
        }

        // Mark as cancelled instead of hard delete
        await prisma.bounty.update({
          where: { id: bountyId },
          data: { status: 'CANCELLED' },
        });
      }
    }

    // Process application changes
    if (changes.applications) {
      // Created applications
      for (const app of changes.applications.created || []) {
        const data = validateApplicationCreate(app);
        await prisma.bountyApplication.create({
          data: {
            ...data,
            applicantId: userId,
          },
        });
      }

      // Updated applications
      for (const app of changes.applications.updated || []) {
        const appId = requireString(app.id, 'id');
        const serverApp = await prisma.bountyApplication.findUnique({
          where: { id: appId },
        });

        if (!serverApp || serverApp.applicantId !== userId) {
          return NextResponse.json(
            { error: 'Forbidden: cannot modify record you do not own' },
            { status: 403 }
          );
        }

        const serverUpdated = serverApp.updatedAt.getTime();
        const clientUpdated = new Date(app.updated_at as string | number | Date).getTime();

        if (clientUpdated > serverUpdated) {
          await prisma.bountyApplication.update({
            where: { id: appId },
            data: validateApplicationUpdate(app),
          });
        } else if (process.env.DEBUG) {
          logger.debug('Conflict: skipping application (server is newer)', { applicationId: appId });
        }
      }

      // Deleted applications
      for (const appId of changes.applications.deleted || []) {
        const app = await prisma.bountyApplication.findUnique({
          where: { id: appId },
        });

        if (!app || app.applicantId !== userId) {
          return NextResponse.json(
            { error: 'Forbidden: cannot modify record you do not own' },
            { status: 403 }
          );
        }

        // Mark as withdrawn instead of hard delete
        await prisma.bountyApplication.update({
          where: { id: appId },
          data: { status: 'WITHDRAWN' },
        });
      }
    }

    return NextResponse.json({
      success: true,
      timestamp: Date.now(),
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json(
        { error: 'Invalid sync payload', details: error.message },
        { status: 400 }
      );
    }
    console.error('Sync push error:', error);
    return NextResponse.json(
      { error: 'Failed to push changes' },
      { status: 500 }
    );
  }
}
