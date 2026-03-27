export type ProjectStatus = 'completed' | 'in-progress' | 'archived';

export interface Project {
  id: string;
  title: string;
  description: string;
  category: string;
  image: string;
  link?: string;
  tags: string[];
  year: number;
  status?: ProjectStatus;
  /** Human-readable engagement length, e.g. "12 weeks". */
  duration?: string;
  /** Technologies / tools; card and modal prefer this over raw tags when set. */
  techStack?: string[];
  /** Longer story for the detail modal; defaults to `description`. */
  detail?: string;
}

export interface Service {
  id: string;
  name: string;
  description: string;
  category: string;
  basePrice: number;
  deliveryTime: number; // in days
  rating: number;
  reviewCount: number;
}

export type VerificationStatus = 'unverified' | 'pending' | 'verified';

export type SpecialBadge = 'top-rated' | 'responsive' | 'certified' | 'rising-star';

export interface VerificationInfo {
  status: VerificationStatus;
  verifiedAt?: string; // ISO date string
  verifiedBy?: string; // admin name
  badges?: SpecialBadge[];
}

export interface Creator {
  id: string;
  name: string;
  title: string;
  discipline: string;
  bio: string;
  avatar: string;
  coverImage: string;
  tagline: string;
  linkedIn: string;
  twitter: string;
  portfolio?: string;
  projects: Project[];
  skills: string[];
  stats?: {
    projects: number;
    clients: number;
    experience: number;
  };
  services?: Service[];
  hourlyRate?: number;
  responseTime?: string; // e.g., "2 hours"
  availability?: 'available' | 'limited' | 'unavailable';
  rating?: number;
  reviewCount?: number;
  verification?: VerificationInfo;
}

export const creators: Creator[] = [
  {
    id: 'alex-studio',
    name: 'Alex Chen',
    title: 'Product Designer',
    discipline: 'UI/UX Design',
    bio: 'Crafting intuitive digital experiences that solve real problems. Specialized in design systems and user-centered methodology.',
    avatar: '/avatars/alex-chen.jpg',
    coverImage: '/covers/design-studio.jpg',
    tagline: 'Design systems that scale',
    linkedIn: 'https://linkedin.com/in/alexchen',
    twitter: 'https://x.com/alexchen',
    portfolio: 'https://alexchen.design',
    skills: ['Figma', 'Design Systems', 'Prototyping', 'User Research', 'Accessibility', 'Design Thinking'],
    stats: {
      projects: 45,
      clients: 20,
      experience: 8,
    },
    projects: [
      {
        id: 'project-1',
        title: 'SaaSPro Design System',
        description:
          'Enterprise design system with tokens, components, and docs adopted by 40+ product squads.',
        category: 'Design System',
        image: '/projects/design-system.jpg',
        link: 'https://saaspro.design',
        tags: ['Design System', 'Figma', 'Enterprise'],
        year: 2024,
        status: 'completed',
        duration: '5 months',
        techStack: ['Figma', 'Storybook', 'React', 'Design Tokens'],
        detail:
          'Partnered with engineering to ship a token-first system, 120+ documented components, and accessibility baked into every pattern. Cut design–dev handoff time by roughly 35% and stabilized UI consistency across five product lines.',
      },
      {
        id: 'project-2',
        title: 'FinTech Mobile App',
        description: 'Mobile banking refresh focused on clarity, trust, and faster money movement.',
        category: 'Product Design',
        image: '/projects/fintech-app.jpg',
        tags: ['Mobile', 'Finance', 'Responsive'],
        year: 2023,
        status: 'in-progress',
        duration: '14 weeks (ongoing)',
        techStack: ['Figma', 'ProtoPie', 'iOS HIG', 'WCAG 2.2'],
        detail:
          'Leading UX for onboarding, transfers, and statements. Running weekly usability tests with 12 participants; latest iteration improved task success for “send money” from 71% to 89%. Dark mode and biometric flows are in beta.',
      },
      {
        id: 'project-3',
        title: 'E-commerce Platform Redesign',
        description: 'End-to-end commerce redesign that lifted conversion and reduced support tickets.',
        category: 'E-commerce',
        image: '/projects/ecommerce.jpg',
        tags: ['E-commerce', 'Conversion', 'UX Research'],
        year: 2023,
        status: 'archived',
        duration: '6 months',
        techStack: ['Sketch', 'Hotjar', 'Google Analytics', 'A/B testing'],
        detail:
          'Archived after successful handoff to the internal team. Project covered navigation IA, PDP templates, and checkout friction removal — validated with quantitative experiments and qualitative diary studies.',
      },
    ],
    verification: {
      status: 'verified',
      verifiedAt: '2024-03-15T10:00:00Z',
      verifiedBy: 'Admin',
      badges: ['top-rated', 'certified'],
    },
  },
  {
    id: 'maya-writes',
    name: 'Maya Patel',
    title: 'Content Strategist & Writer',
    discipline: 'Writing',
    bio: 'Creating compelling narratives and strategic content that drives engagement. Expertise in brand storytelling and technical writing.',
    avatar: '/avatars/maya-patel.jpg',
    coverImage: '/covers/writing-desk.jpg',
    tagline: 'Words that inspire action',
    linkedIn: 'https://linkedin.com/in/mayapatel',
    twitter: 'https://x.com/mayawrites',
    portfolio: 'https://mayapatel.com',
    skills: ['Content Strategy', 'Copywriting', 'Technical Writing', 'Brand Storytelling', 'SEO', 'Editorial'],
    stats: {
      projects: 60,
      clients: 25,
      experience: 10,
    },
    projects: [
      {
        id: 'project-4',
        title: 'TechStartup Brand Guidelines',
        description: 'Voice, tone, and messaging system for a Series B developer tools company.',
        category: 'Brand Strategy',
        image: '/projects/brand-guidelines.jpg',
        tags: ['Branding', 'Strategy', 'Copywriting'],
        year: 2024,
        status: 'completed',
        duration: '10 weeks',
        techStack: ['Notion', 'Grammarly', 'Figma', 'Style guide CMS'],
        detail:
          'Delivered a 60-page guidelines site, elevator pitches for three personas, and reusable content blocks for marketing and product. Writers reported 50% faster first-draft approval cycles.',
      },
      {
        id: 'project-5',
        title: 'API Documentation Suite',
        description: 'Developer docs with auth flows, error catalogs, and runnable examples.',
        category: 'Technical Writing',
        image: '/projects/api-docs.jpg',
        tags: ['Technical Writing', 'Documentation', 'Developers'],
        year: 2023,
        status: 'completed',
        duration: '4 months',
        techStack: ['OpenAPI', 'MDX', 'Docusaurus', 'Postman'],
        detail:
          'Structured reference for 180+ endpoints, migration guides from v1 to v2, and interactive snippets. Partnered with support to cut “how do I auth?” tickets by 42% in two quarters.',
      },
      {
        id: 'project-6',
        title: 'Content Calendar & Strategy',
        description: 'Integrated blog, LinkedIn, and newsletter program for B2B SaaS growth.',
        category: 'Content Strategy',
        image: '/projects/content-calendar.jpg',
        tags: ['Content Marketing', 'Social Media', 'Strategy'],
        year: 2023,
        status: 'in-progress',
        duration: 'Rolling retainer',
        techStack: ['HubSpot', 'Buffer', 'Ahrefs', 'Google Search Console'],
        detail:
          'Editorial engine with quarterly themes, SEO clusters, and sales-enablement briefs. Currently scaling from 2 to 4 posts per week while maintaining quality rubrics and SME interviews.',
      },
    ],
    verification: {
      status: 'verified',
      verifiedAt: '2024-01-20T09:00:00Z',
      verifiedBy: 'Admin',
      badges: ['top-rated', 'responsive'],
    },
  },
  {
    id: 'jordan-creative',
    name: 'Jordan Maxwell',
    title: 'Creative Director',
    discipline: 'Content Creation',
    bio: 'Producing high-impact visual and multimedia content. Known for creative campaigns that generate millions of impressions.',
    avatar: '/avatars/jordan-maxwell.jpg',
    coverImage: '/covers/creative-studio.jpg',
    tagline: 'Content that captivates',
    linkedIn: 'https://linkedin.com/in/jordanmaxwell',
    twitter: 'https://x.com/jordanmax',
    portfolio: 'https://jordanmaxwell.co',
    skills: ['Video Production', 'Photography', 'Motion Design', 'Copywriting', 'Social Content', 'Campaign Strategy'],
    stats: {
      projects: 80,
      clients: 35,
      experience: 12,
    },
    projects: [
      {
        id: 'project-7',
        title: 'Brand Campaign Series',
        description: 'Five-part hero video series for product launch across paid and organic.',
        category: 'Video Production',
        image: '/projects/video-campaign.jpg',
        link: 'https://youtube.com/jordanmaxwell',
        tags: ['Video', 'Campaign', 'Social Media'],
        year: 2024,
        status: 'completed',
        duration: '8 weeks production',
        techStack: ['DaVinci Resolve', 'After Effects', 'RED Komodo', 'Frame.io'],
        detail:
          'Concept through color grade: storyboards, location shoots, motion supers, and platform-specific cuts (9:16, 1:1, 16:9). Campaign exceeded 2.1M organic views with consistent CTA lift in paid retargeting.',
      },
      {
        id: 'project-8',
        title: 'Photography Portfolio Showcase',
        description: 'Lookbook and web gallery for lifestyle and commercial stills.',
        category: 'Photography',
        image: '/projects/photography.jpg',
        tags: ['Photography', 'Commercial', 'Lifestyle'],
        year: 2023,
        status: 'archived',
        duration: '3 weeks',
        techStack: ['Lightroom', 'Capture One', 'Photoshop'],
        detail:
          'Curated 80 selects with consistent color science and web-optimized exports. Archived after client internalized assets; gallery template reused for two follow-on shoots.',
      },
      {
        id: 'project-9',
        title: 'Motion Graphics Package',
        description: 'Stream overlays, stingers, and lower-thirds for a global streaming brand.',
        category: 'Motion Design',
        image: '/projects/motion-design.jpg',
        tags: ['Animation', 'Motion Graphics', 'Branding'],
        year: 2023,
        status: 'in-progress',
        duration: '11 weeks (ongoing)',
        techStack: ['After Effects', 'Cinema 4D', 'Lottie', 'OBS assets'],
        detail:
          'Building modular .mogrt and JSON Lottie deliverables so producers can swap text without reopening AE. Alpha-safe overlays tested on 1080p and 4K pipelines.',
      },
    ],
    verification: {
      status: 'pending',
    },
  },
  {
    id: 'sophia-ux',
    name: 'Sophia Rodriguez',
    title: 'UX Researcher & Designer',
    discipline: 'UI/UX Design',
    bio: 'Data-driven designer focused on research-backed solutions. Passion for accessibility and inclusive design practices.',
    avatar: '/avatars/sophia-rodriguez.jpg',
    coverImage: '/covers/research-lab.jpg',
    tagline: 'Design informed by data',
    linkedIn: 'https://linkedin.com/in/sophiarodriguez',
    twitter: 'https://x.com/sophiaux',
    portfolio: 'https://sophiarodriguez.design',
    skills: ['User Research', 'Usability Testing', 'Wireframing', 'Prototyping', 'Accessibility', 'Analytics'],
    stats: {
      projects: 35,
      clients: 18,
      experience: 7,
    },
    projects: [
      {
        id: 'project-10',
        title: 'Healthcare Platform Redesign',
        description: 'Research-led IA and flows for clinicians and patients, WCAG-aligned.',
        category: 'UX Research',
        image: '/projects/healthcare-ux.jpg',
        tags: ['Healthcare', 'Accessibility', 'Research'],
        year: 2024,
        status: 'completed',
        duration: '7 months',
        techStack: ['Dovetail', 'Figma', 'Maze', 'NVDA'],
        detail:
          'Mixed-methods program: contextual inquiry in three hospitals, diary studies, and moderated usability on critical tasks (scheduling, results, messaging). Shipped prioritized roadmap tied to severity-rated findings.',
      },
      {
        id: 'project-11',
        title: 'Accessibility Audit & Improvement',
        description: 'WCAG 2.2 gap analysis with engineering-ready remediation tickets.',
        category: 'Accessibility',
        image: '/projects/accessibility.jpg',
        tags: ['Accessibility', 'A11y', 'WCAG'],
        year: 2023,
        status: 'completed',
        duration: '6 weeks audit + 12 weeks fixes',
        techStack: ['axe DevTools', 'WAVE', 'VoiceOver', 'JAWS'],
        detail:
          'Automated and manual passes across top 50 templates. Delivered violation backlog with effort estimates; paired with devs on live regions, focus order, and form error patterns.',
      },
      {
        id: 'project-12',
        title: 'User Research Repository',
        description: 'Searchable insights hub: plans, transcripts, and decision logs.',
        category: 'Research',
        image: '/projects/research.jpg',
        tags: ['Research', 'Documentation', 'Methodology'],
        year: 2023,
        status: 'in-progress',
        duration: 'Rolling',
        techStack: ['Notion', 'Dovetail', 'FigJam', 'GitHub'],
        detail:
          'Taxonomy for “question → evidence → decision” with templates for intake, synthesis, and stakeholder readouts. Rolling adoption across three squads; migrating legacy Drive folders.',
      },
    ],
    verification: {
      status: 'unverified',
    },
  },
];

export const disciplines = [
  'All',
  'UI/UX Design',
  'Writing',
  'Content Creation',
  'Product Management',
  'Marketing',
  'Community Management',
  'Project Management',
  'Business Development',
  'Brand Strategy',
  'Sales',
  'Customer Success',
  'HR & Recruiting',
  'Legal & Compliance',
];

export const getDisciplineColor = (discipline: string): string => {
  const colors: Record<string, string> = {
    'UI/UX Design': 'from-blue-500 to-indigo-500',
    'Writing': 'from-purple-500 to-pink-500',
    'Content Creation': 'from-teal-500 to-green-500',
  };
  return colors[discipline] || 'from-gray-500 to-slate-500';
};

// Bounty Platform Types
export interface Bounty {
  id: string;
  title: string;
  description: string;
  budget: number;
  currency: string;
  deadline: Date;
  difficulty: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  category: string;
  tags: string[];
  applicants: number;
  status: 'open' | 'in-progress' | 'completed' | 'cancelled';
  postedBy: string;
  postedDate: Date;
  requiredSkills: string[];
  deliverables: string;
  /** When set, only this user (client) may manage applications. Omit for open demo bounties. */
  ownerUserId?: string | null;
}

export interface BountyApplication {
  id: string;
  bountyId: string;
  creatorId: string;
  proposedBudget: number;
  timeline: number; // in days
  proposal: string;
  status: 'pending' | 'accepted' | 'rejected';
  appliedDate: Date;
}

// Sample bounties
export const bounties: Bounty[] = [
  {
    id: 'bounty-1',
    title: 'Brand Identity Design for Web3 Startup',
    description: 'Create a comprehensive brand identity including logo, color palette, and brand guidelines for an emerging Web3 company.',
    budget: 3000,
    currency: 'USD',
    deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    difficulty: 'advanced',
    category: 'Brand Strategy',
    tags: ['Branding', 'Design', 'Web3', 'Logo Design'],
    applicants: 12,
    status: 'open',
    postedBy: 'company-1',
    postedDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    requiredSkills: ['Brand Design', 'Logo Design', 'Typography', 'Figma'],
    deliverables: 'Logo files, brand guide PDF, color palette, typography system',
  },
  {
    id: 'bounty-2',
    title: 'Technical Documentation for API',
    description: 'Write comprehensive technical documentation for a REST API including examples, authentication, and error handling.',
    budget: 1500,
    currency: 'USD',
    deadline: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    difficulty: 'intermediate',
    category: 'Technical Writing',
    tags: ['API Docs', 'Technical Writing', 'Documentation'],
    applicants: 8,
    status: 'open',
    postedBy: 'company-2',
    postedDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    requiredSkills: ['Technical Writing', 'API Knowledge', 'Markdown'],
    deliverables: 'Complete API documentation, guides, and examples',
  },
  {
    id: 'bounty-3',
    title: 'Social Media Campaign Content Creation',
    description: 'Create a 30-day social media content calendar and produce 60 pieces of content (videos, graphics, copy) for a SaaS company.',
    budget: 2500,
    currency: 'USD',
    deadline: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000),
    difficulty: 'intermediate',
    category: 'Content Creation',
    tags: ['Social Media', 'Content', 'Video', 'Graphics'],
    applicants: 15,
    status: 'open',
    postedBy: 'company-3',
    postedDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
    requiredSkills: ['Video Production', 'Graphic Design', 'Copywriting', 'Social Media'],
    deliverables: 'Content calendar, 60 pieces of content, performance tracking',
  },
  {
    id: 'bounty-4',
    title: 'UX Research & Usability Testing',
    description: 'Conduct user research and usability testing for a mobile app. Include user interviews, testing sessions, and comprehensive report.',
    budget: 4000,
    currency: 'USD',
    deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    difficulty: 'expert',
    category: 'UX Research',
    tags: ['UX Research', 'User Testing', 'Mobile App', 'Analytics'],
    applicants: 6,
    status: 'open',
    postedBy: 'company-4',
    postedDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    requiredSkills: ['UX Research', 'User Testing', 'Analysis', 'Reporting'],
    deliverables: 'Research report, testing videos, recommendations, analysis',
  },
];

export const getCreatorsByDiscipline = (discipline: string): Creator[] => {
  if (discipline === 'All') return creators;
  return creators.filter(creator => creator.discipline === discipline);
};

export interface CreatorSearchParams {
  query?: string;
  discipline?: string;
  skills?: string[];
  experienceRange?: string; // e.g. '3-5', '10+', or 'All'
  sort?: 'relevance' | 'most-reviewed' | 'highest-rated' | 'most-experienced';
}

const EXPERIENCE_RANGES: Record<string, [number, number]> = {
  '0-2':  [0, 2],
  '3-5':  [3, 5],
  '6-10': [6, 10],
  '10+':  [10, 999],
};

export function searchCreators(params: CreatorSearchParams): Creator[] {
  const { query = '', discipline = 'All', skills = [], experienceRange = 'All', sort = 'relevance' } = params;
  const q = query.toLowerCase().trim();

  let results = creators.filter((c) => {
    if (discipline !== 'All' && c.discipline !== discipline) return false;

    if (skills.length > 0 && !skills.every((s) => c.skills.some((cs) => cs.toLowerCase() === s.toLowerCase()))) return false;

    if (experienceRange !== 'All') {
      const range = EXPERIENCE_RANGES[experienceRange];
      const exp = c.stats?.experience ?? 0;
      if (!range || exp < range[0] || exp > range[1]) return false;
    }

    if (q) {
      return (
        c.name.toLowerCase().includes(q) ||
        c.title.toLowerCase().includes(q) ||
        c.bio.toLowerCase().includes(q) ||
        c.discipline.toLowerCase().includes(q) ||
        c.skills.some((s) => s.toLowerCase().includes(q))
      );
    }

    return true;
  });

  switch (sort) {
    case 'most-reviewed':   results = [...results].sort((a, b) => (b.reviewCount ?? 0) - (a.reviewCount ?? 0)); break;
    case 'highest-rated':   results = [...results].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)); break;
    case 'most-experienced': results = [...results].sort((a, b) => (b.stats?.experience ?? 0) - (a.stats?.experience ?? 0)); break;
  }

  return results;
}

export const ALL_SKILLS = Array.from(
  new Set(creators.flatMap((c) => c.skills))
).sort();

export const getBountiesByCategory = (category: string): Bounty[] => {
  if (category === 'All') return bounties;
  return bounties.filter(bounty => bounty.category === category);
};

export const getBountiesByDifficulty = (difficulty: string): Bounty[] => {
  if (difficulty === 'All') return bounties;
  return bounties.filter(bounty => bounty.difficulty === difficulty);
};

export function getBountyById(id: string): Bounty | undefined {
  return bounties.find((b) => b.id === id);
}
