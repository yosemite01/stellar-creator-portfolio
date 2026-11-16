# New Features

## Rich-Text Block Editor (Issue #512)

Creators can now write fully formatted project descriptions using a TipTap-powered block editor.

**What's included:**
- Toolbar with Bold, Italic, Strikethrough, H2/H3, Bullet & Ordered lists, Blockquote, Code block
- Link insertion and YouTube/Loom video embeds
- All output is DOMPurify-sanitized before saving to the database

**Files:**
- `components/ui/rich-text.tsx` — `RichTextEditor` (editable) + `RichTextContent` (read-only renderer)
- `components/forms/project-create.tsx` — Full project creation form using the editor

---

## Suspense Boundaries & Streaming UI (Issue #513)

Pages now stream content progressively using React 18 Suspense + Next.js App Router, so users see skeleton placeholders instantly instead of blank screens.

**What's included:**
- `CreatorProfileSkeleton` and `BountiesPageSkeleton` matching the exact page layouts
- `/creators/[id]` — async Server Component with nested Suspense (profile shell streams first, projects grid streams independently)
- `/bounties` — Suspense-wrapped client page with filtering (difficulty + category) and an Apply modal backed by escrow

**Files:**
- `components/ui/skeleton-group.tsx` — Page-level skeleton components
- `app/creators/[id]/page.tsx` — Streaming creator profile page
- `app/bounties/page.tsx` + `app/bounties/BountiesClient.tsx` — Streaming bounties page with interactive filtering and apply flow

---

## Bounty Templates: Versioning, Server-Side Sanitization & Admin Review (Issue #1821)

Protects platform users from stored XSS and accidental changes to active contracts by versioning templates, sanitizing rich-text markup on write, and enforcing admin moderation.

**What's included:**
- **Immutable Versioning**: Every template update increments `version` and records a point-in-time snapshot in `BountyTemplateVersion`. Live bounties store `templateId` and `templateVersion`, ensuring changes to templates never alter active bounty terms or contracts.
- **Server-Side Sanitization**: All template descriptions are sanitized using isomorphic DOMPurify, stripping dangerous tags (`<script>`, `<iframe>`, event handlers, unsafe protocols). Whitelisted video embeds (`YouTube`, `Loom`) and safe formatting are preserved. Plaintext fields (`title`, `category`, `requiredSkills`) are thoroughly stripped of HTML.
- **Safe Client Rendering**: `renderSafeTemplate` sanitizes template data defensively prior to display in the UI picker or form pre-fills.
- **Admin Moderation**: User-created or modified templates start in `PENDING_REVIEW` and must be audited and approved by an administrator before appearing in public listings.
- **Moderation APIs**:
  - `POST /api/admin/bounty-templates/[id]/review` — Approve or reject templates with audit notes (requires `ADMIN` role).
  - `GET /api/admin/bounty-templates/pending` — Lists pending templates for moderation review.
  - `GET /api/bounty-templates/[id]?version=N` — Retrieves a specific immutable version snapshot.

**Files:**
- `lib/bounty-templates.ts` — Type definitions, version models, and `renderSafeTemplate` helper
- `lib/services/bounty-template-service.ts` — Versioned CRUD, sanitization, and admin review logic
- `app/api/bounty-templates/route.ts` & `[id]/route.ts` — Versioned template endpoints
- `app/api/admin/bounty-templates/` — Admin review and pending queue endpoints
- `__tests__/bounty-templates-security.test.ts` — Security, versioning, and moderation test suite

