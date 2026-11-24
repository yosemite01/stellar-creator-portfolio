/**
 * DB-backed layer on top of the static `SKILLS_TAXONOMY` (issue #1617).
 *
 * `lib/skills-taxonomy.ts`'s `searchSkills`/`resolveSkillId`/`getSkillById`
 * stay synchronous and untouched — the skill combobox UI
 * (`components/ui/skill-combobox.tsx`) calls them directly and doesn't need
 * synonym support to keep working. This module adds the admin-managed,
 * database-backed pieces on top: brand-new skills and extra search
 * synonyms, used by `app/api/skills/route.ts` (search) and
 * `app/api/admin/skills/**` (CRUD).
 */
import { prisma } from '@/lib/prisma';
import {
  SKILLS_TAXONOMY,
  createTaxonomy,
  getDescendants,
  getSkillById,
  normalizeTerm,
  type OntologyNode,
  type SkillCategory,
  type SkillNode,
  type SkillTaxonomy,
} from '@/lib/skills-taxonomy';

export const SKILL_CATEGORIES: SkillCategory[] = [
  'Languages',
  'Frameworks',
  'Design',
  'Disciplines',
  'Tools',
  'Blockchain',
];

const SKILL_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidSkillId(value: string): boolean {
  return SKILL_ID_PATTERN.test(value);
}

export function isValidSkillCategory(value: string): value is SkillCategory {
  return (SKILL_CATEGORIES as string[]).includes(value);
}

/** All admin-added skills, each shaped like a built-in `SkillNode`. */
export async function listAdminSkills(): Promise<SkillNode[]> {
  const rows = await prisma.adminSkill.findMany({ orderBy: { createdAt: 'desc' } });
  return rows.map((row) => ({
    id: row.skillId,
    name: row.name,
    aliases: row.aliases,
    category: row.category as SkillCategory,
  }));
}

/**
 * Resolves `skillId` against the built-in taxonomy first, then
 * admin-added skills. Used to validate a synonym's target before writing
 * it, and to resolve a matched synonym back to a full `SkillNode`.
 */
export async function resolveAnySkill(skillId: string): Promise<SkillNode | null> {
  const builtin = getSkillById(skillId);
  if (builtin) return builtin;

  const admin = await prisma.adminSkill.findUnique({ where: { skillId } });
  if (!admin) return null;

  return {
    id: admin.skillId,
    name: admin.name,
    aliases: admin.aliases,
    category: admin.category as SkillCategory,
  };
}

export async function createAdminSkill(input: {
  skillId: string;
  name: string;
  category: SkillCategory;
  aliases?: string[];
  createdById?: string | null;
}) {
  if (getSkillById(input.skillId)) {
    throw new Error(`"${input.skillId}" already exists in the built-in taxonomy`);
  }

  return prisma.adminSkill.create({
    data: {
      skillId: input.skillId,
      name: input.name,
      category: input.category,
      aliases: input.aliases ?? [],
      createdById: input.createdById ?? null,
    },
  });
}

export async function deleteAdminSkill(skillId: string) {
  // Synonyms with adminSkillId set cascade-delete via the FK; nothing else
  // to clean up here.
  return prisma.adminSkill.delete({ where: { skillId } });
}

export async function listSynonyms(skillId?: string) {
  return prisma.skillSynonym.findMany({
    where: skillId ? { skillId } : undefined,
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Adds a synonym for `skillId`, which may be a built-in taxonomy id or an
 * admin-added skill's id — throws if it's neither (#1617: synonyms must
 * attach to a real skill, not create one implicitly).
 */
export async function addSynonym(input: {
  skillId: string;
  synonym: string;
  createdById?: string | null;
}) {
  const target = await resolveAnySkill(input.skillId);
  if (!target) {
    throw new Error(`Unknown skill "${input.skillId}" — add it first via POST /api/admin/skills`);
  }

  const isAdminSkill = !getSkillById(input.skillId);

  return prisma.skillSynonym.create({
    data: {
      skillId: input.skillId,
      adminSkillId: isAdminSkill ? input.skillId : null,
      synonym: input.synonym,
      createdById: input.createdById ?? null,
    },
  });
}

export async function deleteSynonym(id: string) {
  return prisma.skillSynonym.delete({ where: { id } });
}

/**
 * Search including admin-added skills and synonyms — what
 * `app/api/skills/route.ts` calls. Combines three signals:
 *  1. The static `searchSkills` behaviour (name/alias substring match)
 *     over built-ins + admin-added skills.
 *  2. Synonym substring matches, resolved back to their target skill.
 * Deduplicates by skill id, built-in/admin name matches ranked first.
 */
export async function searchSkillsWithSynonyms(query: string, limit = 8): Promise<SkillNode[]> {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const adminSkills = await listAdminSkills();
  const allSkills = [...SKILLS_TAXONOMY, ...adminSkills];

  const nameMatches: SkillNode[] = [];
  const aliasMatches: SkillNode[] = [];
  for (const skill of allSkills) {
    if (skill.name.toLowerCase().includes(q)) {
      nameMatches.push(skill);
    } else if (skill.aliases.some((a) => a.toLowerCase().includes(q))) {
      aliasMatches.push(skill);
    }
  }

  const matchedSoFar = new Set([...nameMatches, ...aliasMatches].map((s) => s.id));

  const synonymRows = await prisma.skillSynonym.findMany({
    where: { synonym: { contains: q, mode: 'insensitive' } },
  });

  const synonymMatches: SkillNode[] = [];
  for (const row of synonymRows) {
    if (matchedSoFar.has(row.skillId)) continue;
    const resolved = allSkills.find((s) => s.id === row.skillId) ?? (await resolveAnySkill(row.skillId));
    if (resolved && !matchedSoFar.has(resolved.id)) {
      synonymMatches.push(resolved);
      matchedSoFar.add(resolved.id);
    }
  }

  return [...nameMatches, ...aliasMatches, ...synonymMatches].slice(0, limit);
}

// ── Ontology migrations (#1822) ──────────────────────────────────────────────
// Pure helpers over the hierarchical `SkillTaxonomy` in `lib/skills-taxonomy.ts`.


export type ProfileSkillRef = { profileId: string; skills: string[] };

export type MigrationResult = {
  taxonomy: SkillTaxonomy;
  profiles: ProfileSkillRef[];
  migratedCount: number;
};

export function addNode(
  taxonomy: SkillTaxonomy,
  node: OntologyNode,
): SkillTaxonomy {
  if (taxonomy.nodes[node.id]) {
    throw new Error(`Skill node already exists: ${node.id}`);
  }
  if (node.parentId && !taxonomy.nodes[node.parentId]) {
    throw new Error(`Parent skill node not found: ${node.parentId}`);
  }
  return {
    nodes: { ...taxonomy.nodes, [node.id]: { ...node, synonyms: [...node.synonyms] } },
  };
}

export function updateSynonyms(
  taxonomy: SkillTaxonomy,
  id: string,
  synonyms: string[],
): SkillTaxonomy {
  const existing = taxonomy.nodes[id];
  if (!existing) throw new Error(`Skill node not found: ${id}`);
  return {
    nodes: { ...taxonomy.nodes, [id]: { ...existing, synonyms: [...synonyms] } },
  };
}

function rewriteSkills(skills: string[], from: string, to: string): { skills: string[]; changed: boolean } {
  const target = normalizeTerm(to);
  let changed = false;
  const next: string[] = [];
  const seen = new Set<string>();
  for (const skill of skills) {
    const normalized = normalizeTerm(skill);
    const replacement = normalized === normalizeTerm(from) ? target : normalized;
    if (replacement !== normalized) changed = true;
    if (!seen.has(replacement)) {
      seen.add(replacement);
      next.push(replacement);
    } else {
      changed = true;
    }
  }
  return { skills: next, changed };
}

export function mergeNodes(
  taxonomy: SkillTaxonomy,
  sourceId: string,
  targetId: string,
  profiles: ProfileSkillRef[],
): MigrationResult {
  const source = taxonomy.nodes[sourceId];
  const target = taxonomy.nodes[targetId];
  if (!source) throw new Error(`Source skill node not found: ${sourceId}`);
  if (!target) throw new Error(`Target skill node not found: ${targetId}`);
  if (sourceId === targetId) throw new Error("Cannot merge a skill node into itself");

  const nodes: Record<string, OntologyNode> = {};
  for (const [id, node] of Object.entries(taxonomy.nodes)) {
    if (id === sourceId) continue;
    const parentId = node.parentId === sourceId ? targetId : node.parentId;
    nodes[id] = { ...node, parentId };
  }
  const mergedTarget = nodes[targetId];
  const synonyms = new Set<string>([
    ...mergedTarget.synonyms,
    ...source.synonyms,
    source.label,
    source.id,
  ]);
  nodes[targetId] = { ...mergedTarget, synonyms: Array.from(synonyms) };

  let migratedCount = 0;
  const migratedProfiles = profiles.map((profile) => {
    const { skills, changed } = rewriteSkills(profile.skills, sourceId, targetId);
    if (changed) migratedCount += 1;
    return { ...profile, skills };
  });

  return { taxonomy: { nodes }, profiles: migratedProfiles, migratedCount };
}

export function splitNode(
  taxonomy: SkillTaxonomy,
  sourceId: string,
  newNode: OntologyNode,
  profiles: ProfileSkillRef[],
  assignToNew: (profile: ProfileSkillRef) => boolean,
): MigrationResult {
  const source = taxonomy.nodes[sourceId];
  if (!source) throw new Error(`Source skill node not found: ${sourceId}`);
  if (taxonomy.nodes[newNode.id]) throw new Error(`Skill node already exists: ${newNode.id}`);

  const withNode = addNode(taxonomy, { ...newNode, parentId: newNode.parentId ?? source.parentId });

  let migratedCount = 0;
  const migratedProfiles = profiles.map((profile) => {
    if (!assignToNew(profile)) return profile;
    const { skills, changed } = rewriteSkills(profile.skills, sourceId, newNode.id);
    if (changed) migratedCount += 1;
    return { ...profile, skills };
  });

  return { taxonomy: withNode, profiles: migratedProfiles, migratedCount };
}

export function removeNode(
  taxonomy: SkillTaxonomy,
  id: string,
): SkillTaxonomy {
  if (!taxonomy.nodes[id]) throw new Error(`Skill node not found: ${id}`);
  const descendants = getDescendants(taxonomy, id);
  if (descendants.length > 0) {
    throw new Error(`Cannot remove skill node with children: ${id}`);
  }
  const nodes = { ...taxonomy.nodes };
  delete nodes[id];
  return { nodes };
}

export { createTaxonomy };
