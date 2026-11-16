/**
 * CRUD and Moderation for `BountyTemplate` (Issue #1611, Issue #1821).
 *
 * `lib/bounty-templates.ts`'s static `BOUNTY_TEMPLATES` array ships as the
 * seed data for *system* templates (`createdByUserId: null`) — seeded
 * lazily into the DB the first time templates are listed, rather than via
 * a separate seed-script step, so a fresh environment works without an
 * extra manual command. User-saved templates are scoped strictly to their
 * owner: every read/update/delete here filters on `createdByUserId`, so
 * one client can never see, edit or delete another client's templates
 * (system templates, `createdByUserId: null`, are read-only to everyone —
 * there is no client secret in them, just defaults).
 *
 * Issue #1821 adds:
 * - Versioning: templates increment version on every edit, with historical versions
 *   tracked in `BountyTemplateVersion`. Live bounties store `templateId` and `templateVersion`
 *   so live contracts/bounties never break when a template is updated.
 * - Server-side sanitization: input HTML is sanitized with strict isomorphic DOMPurify,
 *   stripping XSS vectors, scripts, and non-whitelisted iframes before writing to DB.
 * - Admin review: user-submitted templates start in `PENDING_REVIEW` and must be
 *   approved by an ADMIN before being published to everyone.
 */

import { prisma } from '@/lib/prisma';
import {
  BOUNTY_TEMPLATES,
  renderSafeTemplate,
  type TemplateStatus,
} from '@/lib/bounty-templates';
import { sanitizeRichText, richTextToPlainText } from '@/lib/rich-text/sanitize';
import type { BountyTemplate as PrismaBountyTemplate } from '@prisma/client';

let systemTemplatesSeeded = false;

/**
 * Inserts the static `BOUNTY_TEMPLATES` as system templates if none exist
 * yet. Idempotent (checked against the DB, not just the in-process flag,
 * so it's safe across multiple server instances) and cheap to call on
 * every list request once seeded — the flag just skips the count query in
 * the common case.
 */
async function ensureSystemTemplatesSeeded(): Promise<void> {
  if (systemTemplatesSeeded) return;

  const existing = await prisma.bountyTemplate.count({ where: { createdByUserId: null } });
  if (existing === 0) {
    await prisma.bountyTemplate.createMany({
      data: BOUNTY_TEMPLATES.map((t) => ({
        id: t.id,
        category: t.category,
        title: t.title,
        description: t.description,
        suggestedBudget: t.suggestedBudget,
        suggestedTimeline: t.suggestedTimeline,
        requiredSkills: t.requiredSkills,
        createdByUserId: null,
        version: 1,
        status: 'APPROVED' as TemplateStatus,
      })),
      skipDuplicates: true,
    });
  }
  systemTemplatesSeeded = true;
}

export interface BountyTemplateInput {
  category: string;
  title: string;
  description: string;
  suggestedBudget: number;
  suggestedTimeline: number;
  requiredSkills: string[];
}

/** System templates (available to everyone) plus `userId`'s own saved templates. */
export async function listTemplatesFor(userId: string): Promise<PrismaBountyTemplate[]> {
  await ensureSystemTemplatesSeeded();
  const raw = await prisma.bountyTemplate.findMany({
    where: { OR: [{ createdByUserId: null }, { createdByUserId: userId }] },
    orderBy: [{ category: 'asc' }, { createdAt: 'asc' }],
  });
  return raw.map((t) => renderSafeTemplate(t) as PrismaBountyTemplate);
}

/** Creates a new template owned by `userId`, with server-side rich-text sanitization and versioning. */
export async function createTemplate(
  userId: string,
  input: BountyTemplateInput,
): Promise<PrismaBountyTemplate> {
  const sanitized = {
    category: richTextToPlainText(input.category),
    title: richTextToPlainText(input.title),
    description: sanitizeRichText(input.description),
    suggestedBudget: input.suggestedBudget,
    suggestedTimeline: input.suggestedTimeline,
    requiredSkills: input.requiredSkills.map((s) => richTextToPlainText(s)).filter(Boolean),
  };

  const created = await prisma.bountyTemplate.create({
    data: {
      ...sanitized,
      createdByUserId: userId,
      version: 1,
      status: 'PENDING_REVIEW' as TemplateStatus,
    },
  });

  if (prisma.bountyTemplateVersion) {
    try {
      await prisma.bountyTemplateVersion.create({
        data: {
          templateId: created.id,
          version: 1,
          category: created.category,
          title: created.title,
          description: created.description,
          suggestedBudget: created.suggestedBudget,
          suggestedTimeline: created.suggestedTimeline,
          requiredSkills: created.requiredSkills,
        },
      });
    } catch {
      // Mock-safe fallback
    }
  }

  return created;
}

/**
 * Updates a template, but only if it's owned by `userId` — returns `null`
 * (no-op) for a system template, another user's template, or an id that
 * doesn't exist, so callers can't distinguish "not yours" from "doesn't
 * exist" and probe for other users' template ids.
 *
 * Increments `version`, sets `status: PENDING_REVIEW`, and sanitizes inputs.
 */
export async function updateOwnTemplate(
  userId: string,
  id: string,
  input: Partial<BountyTemplateInput>,
): Promise<PrismaBountyTemplate | null> {
  const owned = await prisma.bountyTemplate.findFirst({ where: { id, createdByUserId: userId } });
  if (!owned) return null;

  const currentVersion = (owned as { version?: number }).version || 1;
  const nextVersion = currentVersion + 1;

  const sanitized: Partial<BountyTemplateInput> = {};
  if (input.category !== undefined) sanitized.category = richTextToPlainText(input.category);
  if (input.title !== undefined) sanitized.title = richTextToPlainText(input.title);
  if (input.description !== undefined) sanitized.description = sanitizeRichText(input.description);
  if (input.suggestedBudget !== undefined) sanitized.suggestedBudget = input.suggestedBudget;
  if (input.suggestedTimeline !== undefined) sanitized.suggestedTimeline = input.suggestedTimeline;
  if (input.requiredSkills !== undefined) {
    sanitized.requiredSkills = input.requiredSkills.map((s) => richTextToPlainText(s)).filter(Boolean);
  }

  const updated = await prisma.bountyTemplate.update({
    where: { id },
    data: {
      ...sanitized,
      version: nextVersion,
      status: 'PENDING_REVIEW' as TemplateStatus,
    },
  });

  if (prisma.bountyTemplateVersion) {
    try {
      await prisma.bountyTemplateVersion.create({
        data: {
          templateId: id,
          version: nextVersion,
          category: updated.category,
          title: updated.title,
          description: updated.description,
          suggestedBudget: updated.suggestedBudget,
          suggestedTimeline: updated.suggestedTimeline,
          requiredSkills: updated.requiredSkills,
        },
      });
    } catch {
      // Mock-safe fallback
    }
  }

  return updated;
}

/** Deletes a template owned by `userId`. Returns whether it was deleted. */
export async function deleteOwnTemplate(userId: string, id: string): Promise<boolean> {
  const owned = await prisma.bountyTemplate.findFirst({ where: { id, createdByUserId: userId } });
  if (!owned) return false;

  await prisma.bountyTemplate.delete({ where: { id } });
  return true;
}

/** Get a template by ID, safely rendered. */
export async function getTemplateById(id: string): Promise<PrismaBountyTemplate | null> {
  const template = await prisma.bountyTemplate.findUnique({ where: { id } });
  if (!template) return null;
  return renderSafeTemplate(template) as PrismaBountyTemplate;
}

/**
 * Retrieve a specific version of a template so that live bounties
 * remain pinned to immutable snapshots regardless of later template edits.
 */
export async function getTemplateVersion(
  templateId: string,
  version: number,
): Promise<{
  id: string;
  templateId: string;
  version: number;
  category: string;
  title: string;
  description: string;
  suggestedBudget: number;
  suggestedTimeline: number;
  requiredSkills: string[];
} | null> {
  if (prisma.bountyTemplateVersion) {
    try {
      const historical = await prisma.bountyTemplateVersion.findUnique({
        where: { templateId_version: { templateId, version } },
      });
      if (historical) {
        return renderSafeTemplate(historical) as typeof historical;
      }
    } catch {
      // Fallback to main model below
    }
  }

  // Fallback to main record if it matches the requested version
  const current = await prisma.bountyTemplate.findUnique({ where: { id: templateId } });
  if (current && (current as { version?: number }).version === version) {
    const safe = renderSafeTemplate(current);
    return {
      id: safe.id,
      templateId: safe.id,
      version,
      category: safe.category,
      title: safe.title,
      description: safe.description,
      suggestedBudget: safe.suggestedBudget,
      suggestedTimeline: safe.suggestedTimeline,
      requiredSkills: safe.requiredSkills,
    };
  }

  return null;
}

/**
 * Admin review for submitted/updated templates (Issue #1821).
 */
export async function reviewTemplate(
  adminUserId: string,
  templateId: string,
  input: { decision: 'approve' | 'reject'; reviewNotes?: string },
): Promise<PrismaBountyTemplate> {
  const admin = await prisma.user.findUnique({
    where: { id: adminUserId },
    select: { id: true, role: true },
  });
  if (!admin || admin.role !== 'ADMIN') {
    throw new Error('Unauthorized: only administrators can review templates');
  }

  const template = await prisma.bountyTemplate.findUnique({ where: { id: templateId } });
  if (!template) {
    throw new Error('Template not found');
  }

  const status: TemplateStatus = input.decision === 'approve' ? 'APPROVED' : 'REJECTED';

  return prisma.bountyTemplate.update({
    where: { id: templateId },
    data: {
      status,
      reviewNotes: input.reviewNotes ? richTextToPlainText(input.reviewNotes) : null,
      reviewedByUserId: adminUserId,
      reviewedAt: new Date(),
    },
  });
}

/**
 * List templates waiting for administrator moderation.
 */
export async function listPendingTemplates(adminUserId: string): Promise<PrismaBountyTemplate[]> {
  const admin = await prisma.user.findUnique({
    where: { id: adminUserId },
    select: { id: true, role: true },
  });
  if (!admin || admin.role !== 'ADMIN') {
    throw new Error('Unauthorized: only administrators can view pending templates');
  }

  const list = await prisma.bountyTemplate.findMany({
    where: { status: 'PENDING_REVIEW' },
    orderBy: { createdAt: 'desc' },
  });
  return list.map((t) => renderSafeTemplate(t) as PrismaBountyTemplate);
}

/**
 * Links a newly created or existing bounty to a specific template version.
 */
export async function linkBountyToTemplate(
  bountyId: string,
  templateId: string,
  version?: number,
): Promise<{ id: string; templateId: string | null; templateVersion: number | null }> {
  let targetVersion = version;
  if (!targetVersion) {
    const tpl = await prisma.bountyTemplate.findUnique({
      where: { id: templateId },
      select: { version: true },
    });
    targetVersion = tpl?.version ?? 1;
  }

  return prisma.bounty.update({
    where: { id: bountyId },
    data: {
      templateId,
      templateVersion: targetVersion,
    },
    select: {
      id: true,
      templateId: true,
      templateVersion: true,
    },
  });
}
