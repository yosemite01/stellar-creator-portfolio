import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { getServerSession } = vi.hoisted(() => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/auth/auth', () => ({ getServerSession }));

const { count, createMany, findMany, findFirst, findUnique, create, update, remove, versionCreate, versionFindUnique } = vi.hoisted(() => ({
  count: vi.fn(),
  createMany: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  versionCreate: vi.fn(),
  versionFindUnique: vi.fn(),
}));

const userFindUnique = vi.hoisted(() => vi.fn());
const bountyUpdate = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({
  prisma: {
    bountyTemplate: {
      count,
      createMany,
      findMany,
      findFirst,
      findUnique,
      create,
      update,
      delete: remove,
    },
    bountyTemplateVersion: {
      create: versionCreate,
      findUnique: versionFindUnique,
    },
    user: {
      findUnique: userFindUnique,
    },
    bounty: {
      update: bountyUpdate,
    },
  },
}));

import { POST as createTemplateRoute } from '@/app/api/bounty-templates/route';
import { GET as getTemplateRoute, PATCH as patchTemplateRoute } from '@/app/api/bounty-templates/[id]/route';
import { POST as reviewTemplateRoute } from '@/app/api/bounty-templates/[id]/review/route';
import { GET as pendingTemplatesRoute } from '@/app/api/admin/bounty-templates/pending/route';
import {
  createTemplate,
  updateOwnTemplate,
  getTemplateVersion,
  reviewTemplate,
  listPendingTemplates,
  linkBountyToTemplate,
} from '@/lib/services/bounty-template-service';
import { renderSafeTemplate } from '@/lib/bounty-templates';

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  getServerSession.mockReset();
  count.mockReset().mockResolvedValue(1);
  createMany.mockReset();
  findMany.mockReset().mockResolvedValue([]);
  findFirst.mockReset();
  findUnique.mockReset();
  create.mockReset();
  update.mockReset();
  remove.mockReset();
  versionCreate.mockReset().mockResolvedValue({ id: 'ver-1' });
  versionFindUnique.mockReset();
  userFindUnique.mockReset();
  bountyUpdate.mockReset();
});

describe('Bounty Templates Security & Versioning (Issue #1821)', () => {
  describe('Server-side rich text sanitization', () => {
    it('sanitizes malicious script and onerror payloads in createTemplate', async () => {
      const maliciousInput = {
        category: 'Development <script>alert("xss-cat")</script>',
        title: 'Build Secure API <img src=x onerror=alert("xss-title")>',
        description: '<p>Valid text</p><script>alert("pwned")</script><iframe src="https://evil.com/phish"></iframe>',
        suggestedBudget: 2500,
        suggestedTimeline: 14,
        requiredSkills: ['Rust<script>evil()</script>', 'TypeScript'],
      };

      create.mockImplementation(({ data }) => Promise.resolve({ id: 'tpl-xss-1', ...data }));

      const result = await createTemplate('user-attacker', maliciousInput);

      expect(result.title).toBe('Build Secure API');
      expect(result.category).toBe('Development');
      expect(result.description).toContain('<p>Valid text</p>');
      expect(result.description).not.toContain('<script>');
      expect(result.description).not.toContain('evil.com');
      expect(result.requiredSkills).toEqual(['Rust', 'TypeScript']);
      expect(result.version).toBe(1);
      expect(result.status).toBe('PENDING_REVIEW');
    });

    it('sanitizes malicious payloads via POST /api/bounty-templates route', async () => {
      getServerSession.mockResolvedValue({ user: { id: 'client-evil', role: 'CLIENT' } });

      const maliciousBody = {
        category: 'Design',
        title: 'Exploit <script>alert(1)</script>',
        description: 'Clean intro <svg onload="alert(document.cookie)"> and <a href="javascript:steal()">link</a>',
        suggestedBudget: 1000,
        suggestedTimeline: 5,
        requiredSkills: ['Figma'],
      };

      create.mockImplementation(({ data }) => Promise.resolve({ id: 'tpl-sec-2', ...data }));

      const req = new NextRequest('http://localhost/api/bounty-templates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(maliciousBody),
      });

      const res = await createTemplateRoute(req);
      expect(res.status).toBe(201);

      const passedData = create.mock.calls[0][0].data;
      expect(passedData.title).toBe('Exploit');
      expect(passedData.description).not.toContain('<svg');
      expect(passedData.description).not.toContain('javascript:');
      expect(passedData.version).toBe(1);
      expect(passedData.status).toBe('PENDING_REVIEW');
    });
  });

  describe('Versioning & Immutability', () => {
    it('increments version on template updates and records historical version', async () => {
      findFirst.mockResolvedValue({
        id: 'tpl-v1',
        createdByUserId: 'client-creator',
        version: 1,
        title: 'Original Title',
        category: 'Design',
        description: 'Original Description',
        suggestedBudget: 1000,
        suggestedTimeline: 7,
        requiredSkills: ['UI'],
      });

      update.mockImplementation(({ data }) => Promise.resolve({
        id: 'tpl-v1',
        createdByUserId: 'client-creator',
        ...data,
      }));

      const updated = await updateOwnTemplate('client-creator', 'tpl-v1', {
        title: 'Updated Title v2',
        suggestedBudget: 1200,
      });

      expect(updated).not.toBeNull();
      expect(update).toHaveBeenCalledWith({
        where: { id: 'tpl-v1' },
        data: expect.objectContaining({
          title: 'Updated Title v2',
          suggestedBudget: 1200,
          version: 2,
          status: 'PENDING_REVIEW',
        }),
      });

      expect(versionCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          templateId: 'tpl-v1',
          version: 2,
          title: 'Updated Title v2',
        }),
      });
    });

    it('fetches exact historical version via getTemplateVersion', async () => {
      versionFindUnique.mockResolvedValue({
        id: 'ver-record-1',
        templateId: 'tpl-v1',
        version: 1,
        title: 'Pinned Version 1',
        category: 'Engineering',
        description: 'Historical text preserved',
        suggestedBudget: 1000,
        suggestedTimeline: 10,
        requiredSkills: ['Go'],
        createdAt: new Date(),
      });

      const historical = await getTemplateVersion('tpl-v1', 1);
      expect(historical).not.toBeNull();
      expect(historical?.version).toBe(1);
      expect(historical?.title).toBe('Pinned Version 1');
    });

    it('links bounty to specific template version so live bounty remains immutable', async () => {
      findUnique.mockResolvedValue({
        id: 'tpl-pinned',
        version: 3,
      });

      bountyUpdate.mockImplementation(({ data }) => Promise.resolve({
        id: 'bounty-123',
        templateId: data.templateId,
        templateVersion: data.templateVersion,
      }));

      const linked = await linkBountyToTemplate('bounty-123', 'tpl-pinned');
      expect(linked.templateId).toBe('tpl-pinned');
      expect(linked.templateVersion).toBe(3);
      expect(bountyUpdate).toHaveBeenCalledWith({
        where: { id: 'bounty-123' },
        data: {
          templateId: 'tpl-pinned',
          templateVersion: 3,
        },
        select: {
          id: true,
          templateId: true,
          templateVersion: true,
        },
      });
    });
  });

  describe('Admin Review & Moderation', () => {
    it('rejects review attempts from non-admin users', async () => {
      getServerSession.mockResolvedValue({ user: { id: 'regular-user', role: 'CLIENT' } });

      const req = new NextRequest('http://localhost/api/bounty-templates/tpl-1/review', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'approve' }),
      });

      const res = await reviewTemplateRoute(req, params('tpl-1'));
      expect(res.status).toBe(403);
    });

    it('allows admin to approve a pending template', async () => {
      getServerSession.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
      userFindUnique.mockResolvedValue({ id: 'admin-1', role: 'ADMIN' });
      findUnique.mockResolvedValue({ id: 'tpl-pending-1', status: 'PENDING_REVIEW' });

      update.mockImplementation(({ data }) => Promise.resolve({
        id: 'tpl-pending-1',
        ...data,
      }));

      const req = new NextRequest('http://localhost/api/bounty-templates/tpl-pending-1/review', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'approve', reviewNotes: 'Verified compliant' }),
      });

      const res = await reviewTemplateRoute(req, params('tpl-pending-1'));
      expect(res.status).toBe(200);

      expect(update).toHaveBeenCalledWith({
        where: { id: 'tpl-pending-1' },
        data: expect.objectContaining({
          status: 'APPROVED',
          reviewNotes: 'Verified compliant',
          reviewedByUserId: 'admin-1',
        }),
      });
    });

    it('allows admin to reject a template with audit notes', async () => {
      userFindUnique.mockResolvedValue({ id: 'admin-2', role: 'ADMIN' });
      findUnique.mockResolvedValue({ id: 'tpl-bad', status: 'PENDING_REVIEW' });

      update.mockImplementation(({ data }) => Promise.resolve({
        id: 'tpl-bad',
        ...data,
      }));

      const rejected = await reviewTemplate('admin-2', 'tpl-bad', {
        decision: 'reject',
        reviewNotes: 'Contains disallowed off-platform links',
      });

      expect(rejected.status).toBe('REJECTED');
      expect(rejected.reviewNotes).toBe('Contains disallowed off-platform links');
      expect(rejected.reviewedByUserId).toBe('admin-2');
    });

    it('lists pending templates exclusively for admins', async () => {
      getServerSession.mockResolvedValue({ user: { id: 'admin-3', role: 'ADMIN' } });
      userFindUnique.mockResolvedValue({ id: 'admin-3', role: 'ADMIN' });
      findMany.mockResolvedValue([
        { id: 'p1', title: 'Pending 1', status: 'PENDING_REVIEW', category: 'Tech', description: 'Desc', requiredSkills: [] },
      ]);

      const res = await pendingTemplatesRoute();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.templates).toHaveLength(1);
      expect(json.templates[0].status).toBe('PENDING_REVIEW');
    });
  });

  describe('renderSafeTemplate Helper', () => {
    it('escapes and sanitizes template fields on the fly', () => {
      const raw = {
        id: 'raw-tpl',
        category: 'Category <b>Bold</b>',
        title: 'Title <script>alert(1)</script>',
        description: '<p>Content</p><iframe src="javascript:alert(2)"></iframe>',
        suggestedBudget: 500,
        suggestedTimeline: 3,
        requiredSkills: ['<b>React</b>', '<script>bad()</script>Node'],
      };

      const safe = renderSafeTemplate(raw);
      expect(safe.title).toBe('Title');
      expect(safe.category).toBe('Category Bold');
      expect(safe.description).toBe('<p>Content</p>');
      expect(safe.requiredSkills).toEqual(['React', 'Node']);
    });
  });
});
