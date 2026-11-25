/**
 * CRUD for `BountyTemplate` (Issue #1611).
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
 */

import { prisma } from '@/lib/prisma';
import { BOUNTY_TEMPLATES } from '@/lib/bounty-templates';
import type { BountyTemplate as PrismaBountyTemplate } from '@/lib/generated/prisma/client';

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
  return prisma.bountyTemplate.findMany({
    where: { OR: [{ createdByUserId: null }, { createdByUserId: userId }] },
    orderBy: [{ category: 'asc' }, { createdAt: 'asc' }],
  });
}

/** Creates a new template owned by `userId`. */
export async function createTemplate(
  userId: string,
  input: BountyTemplateInput,
): Promise<PrismaBountyTemplate> {
  return prisma.bountyTemplate.create({
    data: { ...input, createdByUserId: userId, version: 1 },
  });
}

/**
 * Updates a template, but only if it's owned by `userId` — returns `null`
 * (no-op) for a system template, another user's template, or an id that
 * doesn't exist, so callers can't distinguish "not yours" from "doesn't
 * exist" and probe for other users' template ids.
 */
export async function updateOwnTemplate(
  userId: string,
  id: string,
  input: Partial<BountyTemplateInput>,
): Promise<PrismaBountyTemplate | null> {
  const owned = await prisma.bountyTemplate.findFirst({ where: { id, createdByUserId: userId } });
  if (!owned) return null;

  // Every edit is a new revision: bounties pin the version they were created
  // from (Issue #1821), so the counter must move on each update.
  return prisma.bountyTemplate.update({ where: { id }, data: { ...input, version: owned.version + 1 } });
}

/** Deletes a template owned by `userId`. Returns whether it was deleted. */
export async function deleteOwnTemplate(userId: string, id: string): Promise<boolean> {
  const owned = await prisma.bountyTemplate.findFirst({ where: { id, createdByUserId: userId } });
  if (!owned) return false;

  await prisma.bountyTemplate.delete({ where: { id } });
  return true;
}
