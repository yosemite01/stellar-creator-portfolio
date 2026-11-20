import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/server/services/authorization';

/**
 * GET /api/admin/disputes?status=open&page=1&limit=20
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const user = requireAdmin({ user: session?.user });

  const { searchParams } = req.nextUrl;
  const status = searchParams.get('status') ?? 'open';
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10)));
  const skip = (page - 1) * limit;

  const where = status === 'all' ? {} : { status };

  const [disputes, total] = await Promise.all([
    prisma.dispute.findMany({
      where,
      include: {
        evidence: {
          orderBy: { createdAt: 'desc' },
          include: {
            uploadedBy: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.dispute.count({ where }),
  ]);

  return NextResponse.json({ disputes, total, page, limit });
}
