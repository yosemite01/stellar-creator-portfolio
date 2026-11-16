import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { getTaxYearExport } from '@/server/services/earnings-service';

export const runtime = 'nodejs';

const taxExportQuerySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100).default(new Date().getFullYear()),
  format: z.enum(['csv', 'json', '1099', 'vat']).default('csv'),
});

/**
 * GET /api/earnings/tax-export
 * Generates an official tax-year export (CSV, JSON, 1099-NEC, VAT invoice)
 * derived from completed ledger transactions.
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession().catch(() => null);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const parsed = taxExportQuerySchema.safeParse({
    year: searchParams.get('year') ?? undefined,
    format: searchParams.get('format') ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid parameters', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { year, format } = parsed.data;
  const result = await getTaxYearExport(session.user.id, year, format, prisma);

  if (format === 'csv') {
    return new NextResponse(result as string, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="tax-year-${year}-earnings.csv"`,
      },
    });
  }

  if (format === '1099') {
    return new NextResponse(result as string, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="1099-nec-${year}.txt"`,
      },
    });
  }

  if (format === 'vat') {
    return new NextResponse(result as string, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="vat-invoice-${year}.txt"`,
      },
    });
  }

  // JSON format
  return NextResponse.json(result);
}
