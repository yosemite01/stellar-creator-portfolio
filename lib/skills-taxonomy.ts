export type SkillNode = {
  id: string;
  label: string;
  parentId: string | null;
  synonyms: string[];
};

export type SkillTaxonomy = {
  nodes: Record<string, SkillNode>;
};

const SEED: SkillNode[] = [
  { id: "design", label: "Design", parentId: null, synonyms: ["design"] },
  { id: "design-ui", label: "UI Design", parentId: "design", synonyms: ["ui", "interface design"] },
  { id: "design-ux", label: "UX Design", parentId: "design", synonyms: ["ux", "user experience"] },
  { id: "engineering", label: "Engineering", parentId: null, synonyms: ["engineering", "dev"] },
  { id: "engineering-frontend", label: "Frontend", parentId: "engineering", synonyms: ["frontend", "front-end", "react"] },
  { id: "engineering-backend", label: "Backend", parentId: "engineering", synonyms: ["backend", "back-end", "api"] },
  { id: "marketing", label: "Marketing", parentId: null, synonyms: ["marketing", "growth"] },
  { id: "marketing-content", label: "Content Marketing", parentId: "marketing", synonyms: ["content", "copywriting"] },
];

export function createTaxonomy(nodes: SkillNode[] = SEED): SkillTaxonomy {
  const map: Record<string, SkillNode> = {};
  for (const node of nodes) {
    map[node.id] = { ...node, synonyms: [...node.synonyms] };
  }
  return { nodes: map };
}

export function normalizeTerm(term: string): string {
  return term.trim().toLowerCase();
}

export function getAncestors(taxonomy: SkillTaxonomy, id: string): SkillNode[] {
  const chain: SkillNode[] = [];
  let current = taxonomy.nodes[id];
  const seen = new Set<string>();
  while (current && current.parentId && !seen.has(current.parentId)) {
    seen.add(current.parentId);
    const parent = taxonomy.nodes[current.parentId];
    if (!parent) break;
    chain.push(parent);
    current = parent;
  }
  return chain;
}

export function getDescendants(taxonomy: SkillTaxonomy, id: string): SkillNode[] {
  const result: SkillNode[] = [];
  const stack = [id];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const currentId = stack.pop() as string;
    if (seen.has(currentId)) continue;
    seen.add(currentId);
    for (const node of Object.values(taxonomy.nodes)) {
      if (node.parentId === currentId) {
        result.push(node);
        stack.push(node.id);
      }
    }
  }
  return result;
}

export function resolveSkill(taxonomy: SkillTaxonomy, term: string): SkillNode | null {
  const normalized = normalizeTerm(term);
  if (!normalized) return null;
  for (const node of Object.values(taxonomy.nodes)) {
    if (normalizeTerm(node.id) === normalized || normalizeTerm(node.label) === normalized) {
      return node;
    }
    if (node.synonyms.some((syn) => normalizeTerm(syn) === normalized)) {
      return node;
    }
  }
  return null;
}

export function expandSkillTerms(taxonomy: SkillTaxonomy, term: string): string[] {
  const node = resolveSkill(taxonomy, term);
  if (!node) return [normalizeTerm(term)].filter(Boolean);
  const related = [node, ...getAncestors(taxonomy, node.id), ...getDescendants(taxonomy, node.id)];
  const terms = new Set<string>();
  for (const item of related) {
    terms.add(normalizeTerm(item.id));
    terms.add(normalizeTerm(item.label));
    for (const syn of item.synonyms) terms.add(normalizeTerm(syn));
  }
  return Array.from(terms).filter(Boolean);
}

export function matchesSkill(taxonomy: SkillTaxonomy, profileSkills: string[], query: string): boolean {
  const wanted = new Set(expandSkillTerms(taxonomy, query));
  if (wanted.size === 0) return false;
  for (const skill of profileSkills) {
    const expanded = expandSkillTerms(taxonomy, skill);
    if (expanded.some((term) => wanted.has(term))) return true;
  }
  return false;
}
