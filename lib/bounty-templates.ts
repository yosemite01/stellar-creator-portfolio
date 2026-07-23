// Bounty template seed data — Issue #810
// 20 templates across categories for the "Start from template" picker

export interface BountyTemplate {
  id: string;
  category: string;
  title: string;
  description: string;
  suggestedBudget: number;   // USD
  suggestedTimeline: number; // days
  requiredSkills: string[];
}

export const BOUNTY_TEMPLATES: BountyTemplate[] = [
  // ── Design ────────────────────────────────────────────────────────────────
  {
    id: 'tpl-design-001',
    category: 'UI/UX Design',
    title: 'Mobile App UI Design (iOS + Android)',
    description: 'Design a complete mobile app UI including onboarding, home screen, and core flows. Deliverables: Figma file with components, style guide, and prototype.',
    suggestedBudget: 3000,
    suggestedTimeline: 21,
    requiredSkills: ['Figma', 'iOS Design', 'Android Design', 'Prototyping'],
  },
  {
    id: 'tpl-design-002',
    category: 'UI/UX Design',
    title: 'Landing Page Design',
    description: 'Design a high-converting landing page. Deliverables: desktop and mobile designs in Figma, exported assets, and a brief UX rationale.',
    suggestedBudget: 1200,
    suggestedTimeline: 7,
    requiredSkills: ['Figma', 'Web Design', 'Conversion Optimization'],
  },
  {
    id: 'tpl-design-003',
    category: 'Brand Strategy',
    title: 'Full Brand Identity Package',
    description: 'Create a complete brand identity: logo suite, color palette, typography, business card, and brand guidelines document.',
    suggestedBudget: 2500,
    suggestedTimeline: 14,
    requiredSkills: ['Logo Design', 'Brand Identity', 'Adobe Illustrator'],
  },
  {
    id: 'tpl-design-004',
    category: 'UI/UX Design',
    title: 'UX Audit & Recommendations',
    description: 'Conduct a thorough UX audit of an existing product. Deliverables: heatmap analysis, usability report, and a prioritized list of improvements.',
    suggestedBudget: 1800,
    suggestedTimeline: 10,
    requiredSkills: ['UX Research', 'Usability Testing', 'Figma'],
  },

  // ── Writing ───────────────────────────────────────────────────────────────
  {
    id: 'tpl-writing-001',
    category: 'Writing',
    title: 'Technical Blog Post Series (5 articles)',
    description: 'Write 5 SEO-optimized technical blog posts (1,500–2,000 words each) on a given topic. Includes keyword research, outlines, and two rounds of revisions.',
    suggestedBudget: 1500,
    suggestedTimeline: 21,
    requiredSkills: ['Technical Writing', 'SEO', 'Content Strategy'],
  },
  {
    id: 'tpl-writing-002',
    category: 'Writing',
    title: 'Product Copywriting (Website)',
    description: 'Write compelling copy for a product website: hero, features, pricing, and FAQ sections. Tone and brand voice guidelines to be provided.',
    suggestedBudget: 900,
    suggestedTimeline: 7,
    requiredSkills: ['Copywriting', 'UX Writing', 'Brand Voice'],
  },
  {
    id: 'tpl-writing-003',
    category: 'Writing',
    title: 'Whitepaper / Research Report',
    description: 'Produce a 4,000–6,000 word whitepaper on a specified topic with citations, executive summary, and designed PDF layout.',
    suggestedBudget: 2200,
    suggestedTimeline: 18,
    requiredSkills: ['Research Writing', 'Technical Writing', 'Data Interpretation'],
  },

  // ── Marketing ─────────────────────────────────────────────────────────────
  {
    id: 'tpl-marketing-001',
    category: 'Marketing',
    title: 'Go-to-Market Strategy',
    description: 'Develop a complete GTM strategy including target audience analysis, positioning, channel plan, and 90-day execution roadmap.',
    suggestedBudget: 3500,
    suggestedTimeline: 21,
    requiredSkills: ['Marketing Strategy', 'Market Research', 'Positioning'],
  },
  {
    id: 'tpl-marketing-002',
    category: 'Marketing',
    title: 'Social Media Content Calendar (1 month)',
    description: 'Create a 30-day social media content calendar for 3 platforms with copy, visuals briefs, and hashtag strategy.',
    suggestedBudget: 1200,
    suggestedTimeline: 10,
    requiredSkills: ['Social Media', 'Content Creation', 'Copywriting'],
  },
  {
    id: 'tpl-marketing-003',
    category: 'Community Management',
    title: 'Community Launch & Growth Plan',
    description: 'Design and execute a community launch strategy: welcome sequences, engagement playbooks, and moderation guidelines for Discord or Slack.',
    suggestedBudget: 2000,
    suggestedTimeline: 28,
    requiredSkills: ['Community Management', 'Discord', 'Content Strategy'],
  },

  // ── Product ───────────────────────────────────────────────────────────────
  {
    id: 'tpl-product-001',
    category: 'Product Management',
    title: 'Product Requirements Document (PRD)',
    description: 'Write a comprehensive PRD for a new feature or product: problem statement, user stories, acceptance criteria, and success metrics.',
    suggestedBudget: 1500,
    suggestedTimeline: 10,
    requiredSkills: ['Product Management', 'User Stories', 'Agile'],
  },
  {
    id: 'tpl-product-002',
    category: 'Product Management',
    title: 'Competitive Analysis Report',
    description: 'Deliver a detailed competitive analysis covering 5–8 competitors: feature matrix, pricing, positioning, and strategic recommendations.',
    suggestedBudget: 1800,
    suggestedTimeline: 14,
    requiredSkills: ['Market Research', 'Competitive Analysis', 'Strategy'],
  },
  {
    id: 'tpl-product-003',
    category: 'Project Management',
    title: 'Project Kick-off & Sprint Planning',
    description: 'Lead project kick-off workshops, define scope, create a sprint plan in Jira/Linear, and establish team cadence and communication norms.',
    suggestedBudget: 2500,
    suggestedTimeline: 14,
    requiredSkills: ['Agile', 'Scrum', 'Jira', 'Project Management'],
  },

  // ── Data & Analytics ──────────────────────────────────────────────────────
  {
    id: 'tpl-data-001',
    category: 'Data Analysis',
    title: 'Analytics Dashboard Design & Setup',
    description: 'Design and implement a business analytics dashboard in Looker, Metabase, or Tableau. Includes data model, KPI selection, and user training.',
    suggestedBudget: 2800,
    suggestedTimeline: 21,
    requiredSkills: ['Data Analysis', 'SQL', 'Tableau', 'Data Visualization'],
  },
  {
    id: 'tpl-data-002',
    category: 'Data Analysis',
    title: 'User Research & Insights Report',
    description: 'Run 8–10 user interviews, synthesize findings, and deliver an insights report with affinity map, personas, and actionable recommendations.',
    suggestedBudget: 3200,
    suggestedTimeline: 28,
    requiredSkills: ['UX Research', 'User Interviews', 'Synthesis'],
  },

  // ── Sales & Business ──────────────────────────────────────────────────────
  {
    id: 'tpl-sales-001',
    category: 'Sales',
    title: 'Sales Pitch Deck (Investor-Ready)',
    description: 'Create a polished 12–15 slide pitch deck: problem, solution, market size, business model, traction, team, and ask.',
    suggestedBudget: 2000,
    suggestedTimeline: 10,
    requiredSkills: ['Presentation Design', 'Storytelling', 'Business Strategy'],
  },
  {
    id: 'tpl-sales-002',
    category: 'Business Development',
    title: 'Partnership Outreach & Deal Sourcing',
    description: 'Identify and reach out to 20 potential partners, manage intro calls, and deliver a pipeline report with contact notes and next steps.',
    suggestedBudget: 2500,
    suggestedTimeline: 30,
    requiredSkills: ['Business Development', 'Outreach', 'CRM'],
  },

  // ── HR & Legal ────────────────────────────────────────────────────────────
  {
    id: 'tpl-hr-001',
    category: 'HR & Recruiting',
    title: 'Technical Role Sourcing (5 candidates)',
    description: 'Source and pre-screen 5 qualified candidates for a specified role. Deliverables: candidate profiles, interview notes, and a ranked shortlist.',
    suggestedBudget: 1800,
    suggestedTimeline: 14,
    requiredSkills: ['Recruiting', 'LinkedIn Sourcing', 'Technical Screening'],
  },
  {
    id: 'tpl-legal-001',
    category: 'Legal & Compliance',
    title: 'Privacy Policy & Terms of Service Review',
    description: 'Review and update existing Privacy Policy and Terms of Service to ensure GDPR/CCPA compliance. Includes a gap analysis and a revised document.',
    suggestedBudget: 3000,
    suggestedTimeline: 10,
    requiredSkills: ['Legal Writing', 'GDPR', 'CCPA', 'Privacy Law'],
  },
  {
    id: 'tpl-cs-001',
    category: 'Customer Success',
    title: 'Customer Onboarding Playbook',
    description: 'Design a full customer onboarding playbook: welcome emails, success milestones, health-score criteria, and a 30/60/90-day check-in framework.',
    suggestedBudget: 1600,
    suggestedTimeline: 14,
    requiredSkills: ['Customer Success', 'Onboarding Design', 'SaaS'],
  },
];

export const TEMPLATE_CATEGORIES = [...new Set(BOUNTY_TEMPLATES.map(t => t.category))];
