export type SkillCategory =
  | 'Languages'
  | 'Frameworks'
  | 'Design'
  | 'Disciplines'
  | 'Tools'
  | 'Blockchain';

export interface SkillNode {
  id: string;
  name: string;
  aliases: string[];
  category: SkillCategory;
  parentId?: string;
}

export const SKILLS_TAXONOMY: SkillNode[] = [
  // Languages
  { id: 'typescript', name: 'TypeScript', aliases: ['ts', 'TS'], category: 'Languages' },
  { id: 'javascript', name: 'JavaScript', aliases: ['js', 'JS', 'ES6', 'ESNext'], category: 'Languages' },
  { id: 'rust', name: 'Rust', aliases: ['rust-lang'], category: 'Languages' },
  { id: 'python', name: 'Python', aliases: ['py', 'python3'], category: 'Languages' },
  { id: 'go', name: 'Go', aliases: ['golang'], category: 'Languages' },
  { id: 'solidity', name: 'Solidity', aliases: ['sol'], category: 'Languages' },
  { id: 'swift', name: 'Swift', aliases: [], category: 'Languages' },
  { id: 'kotlin', name: 'Kotlin', aliases: [], category: 'Languages' },

  // Frameworks
  { id: 'react', name: 'React', aliases: ['ReactJS', 'react.js'], category: 'Frameworks' },
  { id: 'nextjs', name: 'Next.js', aliases: ['nextjs', 'next'], category: 'Frameworks' },
  { id: 'vue', name: 'Vue', aliases: ['VueJS', 'vue.js', 'Vue 3'], category: 'Frameworks' },
  { id: 'svelte', name: 'Svelte', aliases: ['SvelteKit'], category: 'Frameworks' },
  { id: 'express', name: 'Express', aliases: ['expressjs', 'express.js'], category: 'Frameworks' },
  { id: 'nestjs', name: 'NestJS', aliases: ['nest'], category: 'Frameworks' },
  { id: 'react-native', name: 'React Native', aliases: ['RN', 'react native'], category: 'Frameworks' },

  // Blockchain
  { id: 'soroban', name: 'Soroban', aliases: ['soroban-sdk', 'soroban sdk'], category: 'Blockchain' },
  { id: 'stellar', name: 'Stellar', aliases: ['XLM', 'stellar network'], category: 'Blockchain' },
  { id: 'ethereum', name: 'Ethereum', aliases: ['ETH', 'EVM'], category: 'Blockchain' },
  { id: 'solana', name: 'Solana', aliases: ['SOL'], category: 'Blockchain' },
  { id: 'polkadot', name: 'Polkadot', aliases: ['DOT', 'substrate'], category: 'Blockchain' },

  // Design
  { id: 'figma', name: 'Figma', aliases: [], category: 'Design' },
  { id: 'tailwindcss', name: 'Tailwind CSS', aliases: ['tailwind', 'tailwindcss'], category: 'Design' },
  { id: 'css', name: 'CSS', aliases: ['CSS3'], category: 'Design' },
  { id: 'scss', name: 'SCSS', aliases: ['sass', 'SASS'], category: 'Design' },
  { id: 'framer', name: 'Framer', aliases: ['framer motion'], category: 'Design' },

  // Disciplines
  { id: 'uiux', name: 'UI/UX Design', aliases: ['UX', 'UI', 'user experience', 'user interface'], category: 'Disciplines' },
  { id: 'smart-contracts', name: 'Smart Contracts', aliases: ['smart contract'], category: 'Disciplines' },
  { id: 'defi', name: 'DeFi', aliases: ['decentralized finance'], category: 'Disciplines' },
  { id: 'nft', name: 'NFT', aliases: ['nfts', 'non-fungible token'], category: 'Disciplines' },
  { id: 'web3', name: 'Web3', aliases: ['web 3', 'dapp', 'dapps'], category: 'Disciplines' },
  { id: 'devops', name: 'DevOps', aliases: ['CI/CD', 'cicd', 'sre'], category: 'Disciplines' },
  { id: 'ml', name: 'Machine Learning', aliases: ['ML', 'AI', 'artificial intelligence'], category: 'Disciplines' },

  // Tools
  { id: 'docker', name: 'Docker', aliases: ['containers', 'dockerfile'], category: 'Tools' },
  { id: 'git', name: 'Git', aliases: ['github', 'gitlab'], category: 'Tools' },
  { id: 'postgresql', name: 'PostgreSQL', aliases: ['postgres', 'pg', 'psql'], category: 'Tools' },
  { id: 'redis', name: 'Redis', aliases: ['redis cache'], category: 'Tools' },
  { id: 'graphql', name: 'GraphQL', aliases: ['gql'], category: 'Tools' },
  { id: 'kubernetes', name: 'Kubernetes', aliases: ['k8s', 'k8'], category: 'Tools' },
];

export function searchSkills(query: string, limit = 8): SkillNode[] {
  if (!query.trim()) return [];
  const q = query.toLowerCase().trim();

  const nameMatches: SkillNode[] = [];
  const aliasMatches: SkillNode[] = [];

  for (const skill of SKILLS_TAXONOMY) {
    if (skill.name.toLowerCase().includes(q)) {
      nameMatches.push(skill);
    } else if (skill.aliases.some((a) => a.toLowerCase().includes(q))) {
      aliasMatches.push(skill);
    }
  }

  return [...nameMatches, ...aliasMatches].slice(0, limit);
}

export function resolveSkillId(input: string): string | null {
  const q = input.toLowerCase().trim();
  for (const skill of SKILLS_TAXONOMY) {
    if (
      skill.name.toLowerCase() === q ||
      skill.aliases.some((a) => a.toLowerCase() === q)
    ) {
      return skill.id;
    }
  }
  return null;
}

export function getSkillById(id: string): SkillNode | undefined {
  return SKILLS_TAXONOMY.find((s) => s.id === id);
}

// ── Hierarchical ontology with synonyms (#1822) ──────────────────────────────
//
// A parent/child skill graph used for query expansion and taxonomy
// migrations (merge/split, see `lib/skills-taxonomy-admin.ts`). It is
// separate from the flat `SKILLS_TAXONOMY` above, which the combobox and
// the DB-backed admin layer use, so its node type is `OntologyNode`.

export type OntologyNode = {
  id: string;
  label: string;
  parentId: string | null;
  synonyms: string[];
};

export type SkillTaxonomy = {
  nodes: Record<string, OntologyNode>;
};

const SEED: OntologyNode[] = [
  { id: "design", label: "Design", parentId: null, synonyms: ["design"] },
  { id: "design-ui", label: "UI Design", parentId: "design", synonyms: ["ui", "interface design"] },
  { id: "design-ux", label: "UX Design", parentId: "design", synonyms: ["ux", "user experience"] },
  { id: "engineering", label: "Engineering", parentId: null, synonyms: ["engineering", "dev"] },
  { id: "engineering-frontend", label: "Frontend", parentId: "engineering", synonyms: ["frontend", "front-end", "react"] },
  { id: "engineering-backend", label: "Backend", parentId: "engineering", synonyms: ["backend", "back-end", "api"] },
  { id: "marketing", label: "Marketing", parentId: null, synonyms: ["marketing", "growth"] },
  { id: "marketing-content", label: "Content Marketing", parentId: "marketing", synonyms: ["content", "copywriting"] },
];

export function createTaxonomy(nodes: OntologyNode[] = SEED): SkillTaxonomy {
  const map: Record<string, OntologyNode> = {};
  for (const node of nodes) {
    map[node.id] = { ...node, synonyms: [...node.synonyms] };
  }
  return { nodes: map };
}

export function normalizeTerm(term: string): string {
  return term.trim().toLowerCase();
}

export function getAncestors(taxonomy: SkillTaxonomy, id: string): OntologyNode[] {
  const chain: OntologyNode[] = [];
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

export function getDescendants(taxonomy: SkillTaxonomy, id: string): OntologyNode[] {
  const result: OntologyNode[] = [];
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

export function resolveSkill(taxonomy: SkillTaxonomy, term: string): OntologyNode | null {
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
