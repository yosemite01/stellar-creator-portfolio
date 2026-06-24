/**
 * Bounty template library for speeding up bounty creation.
 *
 * Provides 20 seed templates across categories (Design, Writing, Development,
 * Marketing, etc.) that pre-fill the bounty creation form. Users can also
 * save their completed bounties as custom templates.
 */

export interface BountyTemplate {
  id: string;
  category: string;
  title: string;
  description: string;
  suggestedBudget: number;
  suggestedTimeline: number; // in days
  requiredSkills: string[];
  difficulty: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  tags: string[];
  deliverables: string;
}

/** 20 seed templates across categories. */
export const SEED_TEMPLATES: BountyTemplate[] = [
  // Design
  {
    id: 'tpl-logo-design',
    category: 'Design',
    title: 'Logo Design',
    description: 'Create a modern, memorable logo for a tech startup. Include primary mark, horizontal lockup, and favicon variants. Deliver in SVG, PNG, and PDF formats with a one-page brand color and typography guide.',
    suggestedBudget: 800,
    suggestedTimeline: 7,
    requiredSkills: ['Logo Design', 'Typography', 'Vector Graphics', 'Figma'],
    difficulty: 'intermediate',
    tags: ['Branding', 'Logo', 'Design'],
    deliverables: 'SVG/PNG/PDF logo files, favicon set, color palette, typography guide',
  },
  {
    id: 'tpl-brand-identity',
    category: 'Design',
    title: 'Brand Identity Package',
    description: 'Full brand identity including logo, color palette, typography system, business card design, letterhead, and social media templates. Provide a comprehensive brand guidelines PDF.',
    suggestedBudget: 2500,
    suggestedTimeline: 21,
    requiredSkills: ['Brand Design', 'Typography', 'Color Theory', 'Figma'],
    difficulty: 'advanced',
    tags: ['Branding', 'Identity', 'Design'],
    deliverables: 'Logo suite, brand guide PDF, business card, letterhead, social templates',
  },
  {
    id: 'tpl-ui-ux-mockup',
    category: 'Design',
    title: 'UI/UX Mockup Design',
    description: 'Design high-fidelity mockups for a web or mobile application. Include at least 5 key screens, a component library, and a style guide. Deliver in Figma with prototype interactions.',
    suggestedBudget: 1500,
    suggestedTimeline: 14,
    requiredSkills: ['UI Design', 'UX Research', 'Figma', 'Prototyping'],
    difficulty: 'intermediate',
    tags: ['UI', 'UX', 'Design'],
    deliverables: 'Figma file with 5+ screens, component library, style guide, prototype',
  },
  {
    id: 'tpl-social-media-graphics',
    category: 'Design',
    title: 'Social Media Graphics Set',
    description: 'Create a set of 10 social media graphics for Instagram, Twitter, and LinkedIn. Include editable templates in Figma and exported PNGs sized for each platform.',
    suggestedBudget: 500,
    suggestedTimeline: 5,
    requiredSkills: ['Graphic Design', 'Social Media', 'Figma'],
    difficulty: 'beginner',
    tags: ['Social Media', 'Graphics', 'Design'],
    deliverables: '10 editable Figma templates, 30 exported PNGs (3 sizes each)',
  },
  // Writing
  {
    id: 'tpl-technical-docs',
    category: 'Writing',
    title: 'Technical API Documentation',
    description: 'Write comprehensive technical documentation for a REST API including authentication, endpoints, request/response examples, error handling, and SDK usage examples.',
    suggestedBudget: 1200,
    suggestedTimeline: 10,
    requiredSkills: ['Technical Writing', 'API Documentation', 'Markdown'],
    difficulty: 'intermediate',
    tags: ['Documentation', 'API', 'Writing'],
    deliverables: 'Markdown docs, OpenAPI spec, code examples, README update',
  },
  {
    id: 'tpl-blog-article',
    category: 'Writing',
    title: 'SEO Blog Article (1500 words)',
    description: 'Write a well-researched, SEO-optimized blog article on a given topic. Include keyword research, meta description, and 3 internal/external link suggestions.',
    suggestedBudget: 300,
    suggestedTimeline: 3,
    requiredSkills: ['Content Writing', 'SEO', 'Research'],
    difficulty: 'beginner',
    tags: ['Blog', 'SEO', 'Writing'],
    deliverables: '1500-word article in Markdown, meta description, keyword list',
  },
  {
    id: 'tpl-copywriting-website',
    category: 'Writing',
    title: 'Website Copywriting',
    description: 'Write compelling copy for a 5-page website including home, about, services, pricing, and contact pages. Optimized for conversions and readability.',
    suggestedBudget: 900,
    suggestedTimeline: 7,
    requiredSkills: ['Copywriting', 'Marketing', 'Conversion Optimization'],
    difficulty: 'intermediate',
    tags: ['Copywriting', 'Website', 'Marketing'],
    deliverables: '5 pages of website copy in Markdown, CTA suggestions, tone guide',
  },
  {
    id: 'tpl-press-release',
    category: 'Writing',
    title: 'Press Release Writing',
    description: 'Write a professional press release for a product launch or company announcement. Include headline, dateline, body, boilerplate, and media contact section.',
    suggestedBudget: 400,
    suggestedTimeline: 2,
    requiredSkills: ['PR Writing', 'Journalism', 'Editing'],
    difficulty: 'beginner',
    tags: ['PR', 'Press Release', 'Writing'],
    deliverables: '1-page press release in DOCX and Markdown formats',
  },
  // Development
  {
    id: 'tpl-landing-page',
    category: 'Development',
    title: 'Landing Page Development',
    description: 'Build a responsive, fast-loading landing page with hero section, features, testimonials, pricing, and CTA. Use Next.js, Tailwind CSS, and include basic SEO meta tags.',
    suggestedBudget: 1000,
    suggestedTimeline: 7,
    requiredSkills: ['React', 'Next.js', 'Tailwind CSS', 'Responsive Design'],
    difficulty: 'intermediate',
    tags: ['Web Development', 'Landing Page', 'React'],
    deliverables: 'Next.js project, deployed URL, Lighthouse score >90',
  },
  {
    id: 'tpl-react-component',
    category: 'Development',
    title: 'React Component Library',
    description: 'Build a set of 5 reusable React components with TypeScript, unit tests, and Storybook stories. Include documentation and usage examples.',
    suggestedBudget: 1200,
    suggestedTimeline: 10,
    requiredSkills: ['React', 'TypeScript', 'Testing', 'Storybook'],
    difficulty: 'advanced',
    tags: ['React', 'Components', 'TypeScript'],
    deliverables: '5 components, tests, Storybook stories, README',
  },
  {
    id: 'tpl-api-development',
    category: 'Development',
    title: 'REST API Development',
    description: 'Build a RESTful API with CRUD operations, authentication, input validation, and error handling. Include OpenAPI documentation and Postman collection.',
    suggestedBudget: 2000,
    suggestedTimeline: 14,
    requiredSkills: ['Node.js', 'Express', 'PostgreSQL', 'API Design'],
    difficulty: 'advanced',
    tags: ['API', 'Backend', 'Node.js'],
    deliverables: 'API source code, OpenAPI spec, Postman collection, README',
  },
  {
    id: 'tpl-mobile-app',
    category: 'Development',
    title: 'Mobile App Prototype',
    description: 'Build a React Native mobile app prototype with 3-5 key screens, navigation, and mock data. Include setup instructions and a demo build.',
    suggestedBudget: 3000,
    suggestedTimeline: 21,
    requiredSkills: ['React Native', 'Mobile Development', 'Navigation'],
    difficulty: 'expert',
    tags: ['Mobile', 'React Native', 'Prototype'],
    deliverables: 'React Native project, demo APK/IPA, setup instructions',
  },
  // Marketing
  {
    id: 'tpl-social-media-strategy',
    category: 'Marketing',
    title: 'Social Media Strategy Plan',
    description: 'Develop a 30-day social media content calendar with platform-specific content, hashtag strategy, posting schedule, and engagement guidelines.',
    suggestedBudget: 600,
    suggestedTimeline: 5,
    requiredSkills: ['Social Media Marketing', 'Content Strategy', 'Analytics'],
    difficulty: 'beginner',
    tags: ['Social Media', 'Strategy', 'Marketing'],
    deliverables: '30-day content calendar, hashtag strategy, posting schedule',
  },
  {
    id: 'tpl-email-campaign',
    category: 'Marketing',
    title: 'Email Marketing Campaign',
    description: 'Design a 5-email welcome sequence including templates, subject lines, and A/B test variants. Set up in Mailchimp or Klaviyo with segmentation rules.',
    suggestedBudget: 700,
    suggestedTimeline: 7,
    requiredSkills: ['Email Marketing', 'Copywriting', 'Mailchimp'],
    difficulty: 'intermediate',
    tags: ['Email', 'Marketing', 'Campaign'],
    deliverables: '5 email templates, subject lines, A/B variants, setup guide',
  },
  {
    id: 'tpl-seo-audit',
    category: 'Marketing',
    title: 'SEO Audit & Recommendations',
    description: 'Perform a comprehensive SEO audit of an existing website. Analyze technical SEO, on-page factors, backlinks, and provide a prioritized action plan.',
    suggestedBudget: 800,
    suggestedTimeline: 5,
    requiredSkills: ['SEO', 'Analytics', 'Technical Audit'],
    difficulty: 'intermediate',
    tags: ['SEO', 'Audit', 'Marketing'],
    deliverables: 'Audit report PDF, keyword gap analysis, prioritized recommendations',
  },
  {
    id: 'tpl-growth-strategy',
    category: 'Marketing',
    title: 'Growth Marketing Strategy',
    description: 'Develop a 90-day growth marketing strategy covering acquisition, activation, retention, referral, and revenue. Include KPIs, experiment backlog, and channel mix.',
    suggestedBudget: 1500,
    suggestedTimeline: 10,
    requiredSkills: ['Growth Marketing', 'Analytics', 'Strategy'],
    difficulty: 'advanced',
    tags: ['Growth', 'Strategy', 'Marketing'],
    deliverables: 'Strategy document, experiment backlog, KPI dashboard template',
  },
  // Product Management
  {
    id: 'tpl-product-spec',
    category: 'Product',
    title: 'Product Specification Document',
    description: 'Write a detailed product spec for a new feature including user stories, acceptance criteria, wireframe descriptions, success metrics, and rollout plan.',
    suggestedBudget: 1000,
    suggestedTimeline: 7,
    requiredSkills: ['Product Management', 'User Stories', 'Specification'],
    difficulty: 'intermediate',
    tags: ['Product', 'Specification', 'Planning'],
    deliverables: 'PRD document, user stories, acceptance criteria, rollout plan',
  },
  {
    id: 'tpl-user-research',
    category: 'Product',
    title: 'User Research & Personas',
    description: 'Conduct user research including interview guide, survey design, persona development, and journey mapping. Provide actionable insights for product decisions.',
    suggestedBudget: 1200,
    suggestedTimeline: 14,
    requiredSkills: ['User Research', 'Interviews', 'Personas', 'Journey Mapping'],
    difficulty: 'advanced',
    tags: ['User Research', 'Personas', 'Product'],
    deliverables: 'Research report, 3 personas, journey maps, interview guide',
  },
  // Video/Multimedia
  {
    id: 'tpl-explainer-video',
    category: 'Video',
    title: 'Explainer Video Script & Storyboard',
    description: 'Write a 60-second explainer video script and create a storyboard with frame-by-frame visual descriptions. Include voiceover notes and style references.',
    suggestedBudget: 900,
    suggestedTimeline: 7,
    requiredSkills: ['Scriptwriting', 'Storyboarding', 'Video Production'],
    difficulty: 'intermediate',
    tags: ['Video', 'Script', 'Storyboard'],
    deliverables: 'Script document, storyboard PDF, voiceover notes, style references',
  },
  {
    id: 'tpl-youtube-thumbnail',
    category: 'Video',
    title: 'YouTube Thumbnail Design (5 pack)',
    description: 'Design 5 eye-catching YouTube thumbnails for a video series. Include A/B test variants and deliver in 1280x720 PNG format with editable PSD source files.',
    suggestedBudget: 250,
    suggestedTimeline: 3,
    requiredSkills: ['Graphic Design', 'YouTube', 'Photoshop'],
    difficulty: 'beginner',
    tags: ['YouTube', 'Thumbnails', 'Design'],
    deliverables: '5 thumbnail PNGs, editable PSDs, A/B variants',
  },
];

/**
 * Get all seed templates.
 */
export function getSeedTemplates(): BountyTemplate[] {
  return [...SEED_TEMPLATES];
}

/**
 * Get templates filtered by category.
 */
export function getTemplatesByCategory(category: string): BountyTemplate[] {
  if (category === 'All') return getSeedTemplates();
  return SEED_TEMPLATES.filter((t) => t.category === category);
}

/**
 * Get all unique categories from seed templates.
 */
export function getTemplateCategories(): string[] {
  const categories = new Set<string>();
  for (const t of SEED_TEMPLATES) {
    categories.add(t.category);
  }
  return ['All', ...Array.from(categories).sort()];
}

/**
 * Get a template by its ID.
 */
export function getTemplateById(id: string): BountyTemplate | undefined {
  return SEED_TEMPLATES.find((t) => t.id === id);
}

/**
 * Custom user-saved template (stored locally or server-side).
 */
export interface CustomTemplate extends BountyTemplate {
  userId: string;
  originalBountyId?: string;
  createdAt: string;
}

/**
 * Local storage key for user-saved custom templates.
 */
const CUSTOM_TEMPLATES_KEY = 'stellar-custom-templates';

/**
 * Load custom templates from localStorage (client-side only).
 */
export function loadCustomTemplates(): CustomTemplate[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = window.localStorage.getItem(CUSTOM_TEMPLATES_KEY);
    if (!stored) return [];
    return JSON.parse(stored) as CustomTemplate[];
  } catch {
    return [];
  }
}

/**
 * Save a custom template to localStorage.
 */
export function saveCustomTemplate(template: CustomTemplate): CustomTemplate[] {
  if (typeof window === 'undefined') return [];
  const existing = loadCustomTemplates();
  const updated = [...existing, template];
  window.localStorage.setItem(CUSTOM_TEMPLATES_KEY, JSON.stringify(updated));
  return updated;
}

/**
 * Delete a custom template by ID.
 */
export function deleteCustomTemplate(id: string): CustomTemplate[] {
  if (typeof window === 'undefined') return [];
  const existing = loadCustomTemplates();
  const updated = existing.filter((t) => t.id !== id);
  window.localStorage.setItem(CUSTOM_TEMPLATES_KEY, JSON.stringify(updated));
  return updated;
}
