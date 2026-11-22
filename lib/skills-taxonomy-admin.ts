import {
  SkillNode,
  SkillTaxonomy,
  createTaxonomy,
  getDescendants,
  normalizeTerm,
} from "./skills-taxonomy";

export type ProfileSkillRef = { profileId: string; skills: string[] };

export type MigrationResult = {
  taxonomy: SkillTaxonomy;
  profiles: ProfileSkillRef[];
  migratedCount: number;
};

export function addNode(
  taxonomy: SkillTaxonomy,
  node: SkillNode,
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

  const nodes: Record<string, SkillNode> = {};
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
  newNode: SkillNode,
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
