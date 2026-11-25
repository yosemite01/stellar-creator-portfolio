import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from '@/lib/auth/auth';
import { createTemplate, listTemplatesFor } from '@/lib/services/bounty-template-service';
import { sanitizeRichText } from '@/lib/bounty-templates';

/**
 * GET  /api/bounty-templates   system templates + the caller's own saved templates
 * POST /api/bounty-templates   save a new template, owned by the caller
 *
 * See lib/services/bounty-template-service.ts (Issue #1611). Templates are
 * always scoped to the signed-in user — there is no way to create, read,
 * update or delete a template on another user's behalf.
 *
 * Issue #1821: user-provided rich text (description) is sanitised server-side
 * before it is stored, so malicious markup can never be persisted or rendered.
 */

const templateSchema = z.object({
  category: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  suggestedBudget: z.number().int().positive(),
  suggestedTimeline: z.number().int().positive(),
  requiredSkills: z.array(z.string().trim().min(1)).max(20),
});

export async function GET() {
  const session = await getServerSession();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const templates = await listTemplatesFor(userId);
  return NextResponse.json({ templates });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = templateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid template', details: parsed.error.flatten() }, { status: 400 });
  }

  const sanitized = {
    ...parsed.data,
    description: sanitizeRichText(parsed.data.description),
  };

  const template = await createTemplate(userId, sanitized);
  return NextResponse.json({ template }, { status: 201 });
}
