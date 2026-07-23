-- Migration: 20260625_add_bounty_templates_gdpr
-- Issues: #810 (BountyTemplate model) + #811 (GDPR AuditLog support)

-- ── BountyTemplate ─────────────────────────────────────────────────────────────
CREATE TABLE "BountyTemplate" (
    "id"                TEXT NOT NULL,
    "category"          TEXT NOT NULL,
    "title"             TEXT NOT NULL,
    "description"       TEXT NOT NULL,
    "suggestedBudget"   INTEGER NOT NULL,
    "suggestedTimeline" INTEGER NOT NULL,
    "requiredSkills"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdByUserId"   TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BountyTemplate_pkey" PRIMARY KEY ("id")
);

-- FK to User (nullable — null = system template)
ALTER TABLE "BountyTemplate"
    ADD CONSTRAINT "BountyTemplate_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId")
    REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "BountyTemplate_category_idx" ON "BountyTemplate"("category");
CREATE INDEX "BountyTemplate_createdByUserId_idx" ON "BountyTemplate"("createdByUserId");

-- ── Seed 20 system templates (#810) ───────────────────────────────────────────
INSERT INTO "BountyTemplate" ("id","category","title","description","suggestedBudget","suggestedTimeline","requiredSkills","updatedAt") VALUES
('tpl-design-001','UI/UX Design','Mobile App UI Design (iOS + Android)','Design a complete mobile app UI including onboarding, home screen, and core flows. Deliverables: Figma file with components, style guide, and prototype.',3000,21,ARRAY['Figma','iOS Design','Android Design','Prototyping'],NOW()),
('tpl-design-002','UI/UX Design','Landing Page Design','Design a high-converting landing page. Deliverables: desktop and mobile designs in Figma, exported assets, and a brief UX rationale.',1200,7,ARRAY['Figma','Web Design','Conversion Optimization'],NOW()),
('tpl-design-003','Brand Strategy','Full Brand Identity Package','Create a complete brand identity: logo suite, color palette, typography, business card, and brand guidelines document.',2500,14,ARRAY['Logo Design','Brand Identity','Adobe Illustrator'],NOW()),
('tpl-design-004','UI/UX Design','UX Audit & Recommendations','Conduct a thorough UX audit of an existing product. Deliverables: heatmap analysis, usability report, and prioritised improvements.',1800,10,ARRAY['UX Research','Usability Testing','Figma'],NOW()),
('tpl-writing-001','Writing','Technical Blog Post Series (5 articles)','Write 5 SEO-optimized technical blog posts (1,500-2,000 words each). Includes keyword research, outlines, and two rounds of revisions.',1500,21,ARRAY['Technical Writing','SEO','Content Strategy'],NOW()),
('tpl-writing-002','Writing','Product Copywriting (Website)','Write compelling copy for a product website: hero, features, pricing, and FAQ sections.',900,7,ARRAY['Copywriting','UX Writing','Brand Voice'],NOW()),
('tpl-writing-003','Writing','Whitepaper / Research Report','Produce a 4,000-6,000 word whitepaper with citations, executive summary, and designed PDF layout.',2200,18,ARRAY['Research Writing','Technical Writing','Data Interpretation'],NOW()),
('tpl-marketing-001','Marketing','Go-to-Market Strategy','Develop a complete GTM strategy including target audience analysis, positioning, channel plan, and 90-day execution roadmap.',3500,21,ARRAY['Marketing Strategy','Market Research','Positioning'],NOW()),
('tpl-marketing-002','Marketing','Social Media Content Calendar (1 month)','Create a 30-day social media content calendar for 3 platforms with copy, visual briefs, and hashtag strategy.',1200,10,ARRAY['Social Media','Content Creation','Copywriting'],NOW()),
('tpl-marketing-003','Community Management','Community Launch & Growth Plan','Design and execute a community launch strategy: welcome sequences, engagement playbooks, and moderation guidelines.',2000,28,ARRAY['Community Management','Discord','Content Strategy'],NOW()),
('tpl-product-001','Product Management','Product Requirements Document (PRD)','Write a comprehensive PRD: problem statement, user stories, acceptance criteria, and success metrics.',1500,10,ARRAY['Product Management','User Stories','Agile'],NOW()),
('tpl-product-002','Product Management','Competitive Analysis Report','Deliver a detailed competitive analysis covering 5-8 competitors: feature matrix, pricing, positioning, and recommendations.',1800,14,ARRAY['Market Research','Competitive Analysis','Strategy'],NOW()),
('tpl-product-003','Project Management','Project Kick-off & Sprint Planning','Lead project kick-off workshops, define scope, create a sprint plan, and establish team cadence.',2500,14,ARRAY['Agile','Scrum','Jira','Project Management'],NOW()),
('tpl-data-001','Data Analysis','Analytics Dashboard Design & Setup','Design and implement a business analytics dashboard in Looker, Metabase, or Tableau.',2800,21,ARRAY['Data Analysis','SQL','Tableau','Data Visualization'],NOW()),
('tpl-data-002','Data Analysis','User Research & Insights Report','Run 8-10 user interviews, synthesize findings, and deliver an insights report with personas and recommendations.',3200,28,ARRAY['UX Research','User Interviews','Synthesis'],NOW()),
('tpl-sales-001','Sales','Sales Pitch Deck (Investor-Ready)','Create a polished 12-15 slide pitch deck: problem, solution, market size, business model, traction, team, and ask.',2000,10,ARRAY['Presentation Design','Storytelling','Business Strategy'],NOW()),
('tpl-sales-002','Business Development','Partnership Outreach & Deal Sourcing','Identify and reach out to 20 potential partners, manage intro calls, and deliver a pipeline report.',2500,30,ARRAY['Business Development','Outreach','CRM'],NOW()),
('tpl-hr-001','HR & Recruiting','Technical Role Sourcing (5 candidates)','Source and pre-screen 5 qualified candidates. Deliverables: profiles, interview notes, and ranked shortlist.',1800,14,ARRAY['Recruiting','LinkedIn Sourcing','Technical Screening'],NOW()),
('tpl-legal-001','Legal & Compliance','Privacy Policy & Terms of Service Review','Review and update Privacy Policy and Terms of Service for GDPR/CCPA compliance with gap analysis.',3000,10,ARRAY['Legal Writing','GDPR','CCPA','Privacy Law'],NOW()),
('tpl-cs-001','Customer Success','Customer Onboarding Playbook','Design a full onboarding playbook: welcome emails, success milestones, health-score criteria, and 30/60/90-day framework.',1600,14,ARRAY['Customer Success','Onboarding Design','SaaS'],NOW());
