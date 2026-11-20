import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth/auth';
import { requireAuth } from '@/server/services/authorization';

/**
 * CSP violation report sink (issue #1537).
 *
 * Receives both the legacy `application/csp-report` and the Reporting API
 * `application/reports+json` payloads. Reports are aggregated by directive/
 * source, rate limited per client IP, and logged without secrets or PII.
 */

const WINDOW_MS = 60_000;
const MAX_REPORTS_PER_WINDOW = 30;

// ── In-memory aggregation ────────────────────────────────────────────────────

// Report aggregation by directive/source
const reportAggregates = new Map<string, {
  count: number;
  firstSeen: number;
  lastSeen: number;
  samples: Array<{
    blocked: string;
    document: string;
    userAgent: string;
    timestamp: number;
  }>;
}>();

// Simple in-memory sliding window for rate limiting
const hits = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_REPORTS_PER_WINDOW;
}

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || 'unknown';
}

/**
 * Normalize CSP report fields from both legacy and Reporting API formats.
 */
function normalizeReport(report: unknown): {
  directive: string;
  blocked: string;
  document: string;
  userAgent: string;
  timestamp: number;
} | null {
  const r = (report as { 'csp-report'?: Record<string, unknown> })['csp-report'] ??
    (report as { body?: Record<string, unknown> }).body ??
    {};

  const directive = (r['violated-directive'] ?? r['effectiveDirective'] ?? 'unknown') as string;
  const blocked = (r['blocked-uri'] ?? r['blockedURL'] ?? 'unknown') as string;
  const document = (r['document-uri'] ?? r['documentURL'] ?? 'unknown') as string;
  const timestamp = Date.now();

  // Get user agent from request headers (not from report body)
  const userAgent = 'unknown';

  // Sanitize - strip query params and fragments from URIs
  return {
    directive,
    blocked: sanitizeUri(blocked),
    document: sanitizeUri(document),
    userAgent,
    timestamp,
  };
}

/**
 * Sanitize URI to prevent information leakage.
 * - Removes query parameters
 * - Removes fragments
 * - Limits length
 */
function sanitizeUri(uri: string): string {
  try {
    // Basic sanitization: strip query params and fragments
    const [path] = uri.split('?')[0].split('#')[0];
    // Limit length to prevent abuse
    return path.slice(0, 256);
  } catch {
    return uri.slice(0, 256);
  }
}

/**
 * Aggregate a CSP report.
 * Returns the aggregated data for logging/monitoring.
 */
function aggregateReport(normalized: {
  directive: string;
  blocked: string;
  document: string;
  userAgent: string;
  timestamp: number;
}): { aggregateKey: string; data: typeof reportAggregates } {
  const key = `${normalized.directive}|${normalized.blocked}`;
  
  let aggregate = reportAggregates.get(key);
  if (!aggregate) {
    aggregate = {
      count: 0,
      firstSeen: normalized.timestamp,
      lastSeen: normalized.timestamp,
      samples: [],
    };
    reportAggregates.set(key, aggregate);
  }

  aggregate.count++;
  aggregate.lastSeen = normalized.timestamp;

  // Keep only last 5 samples per aggregate to save memory
  if (aggregate.samples.length < 5) {
    aggregate.samples.push({
      blocked: normalized.blocked,
      document: normalized.document,
      userAgent: normalized.userAgent,
      timestamp: normalized.timestamp,
    });
  }

  return { aggregateKey: key, data: reportAggregates };
}

/**
 * Get aggregated report statistics.
 */
export function getAggregatedReports(): Array<{
  key: string;
  directive: string;
  blocked: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  samples: Array<{ blocked: string; document: string; userAgent: string; timestamp: number }>;
}> {
  const results: Array<{
    key: string;
    directive: string;
    blocked: string;
    count: number;
    firstSeen: number;
    lastSeen: number;
    samples: Array<{ blocked: string; document: string; userAgent: string; timestamp: number }>;
  }> = [];

  for (const [key, data] of reportAggregates) {
    const [directive, blocked] = key.split('|');
    results.push({
      key,
      directive,
      blocked,
      count: data.count,
      firstSeen: data.firstSeen,
      lastSeen: data.lastSeen,
      samples: data.samples,
    });
  }

  // Sort by count descending
  return results.sort((a, b) => b.count - a.count);
}

/**
 * Clear aggregated reports (for testing or admin reset).
 */
export function clearAggregatedReports(): void {
  reportAggregates.clear();
}

// ── Report processing ────────────────────────────────────────────────────────

/**
 * Process a CSP violation report.
 * Aggregates, logs, and optionally persists to DB.
 */
async function processReport(
  normalized: {
    directive: string;
    blocked: string;
    document: string;
    userAgent: string;
    timestamp: number;
  },
  userId?: string,
): Promise<void> {
  // Aggregate in memory
  aggregateReport(normalized);

  // Log (without PII)
  console.warn('[csp-report]', {
    directive: normalized.directive,
    blocked: normalized.blocked,
    document: normalized.document,
    userId: userId || 'anonymous',
  });

  // Optionally persist to DB (non-blocking, fire-and-forget)
  // Skip in report-only mode to avoid DB bloat
  if (process.env.CSP_ENFORCE === 'true') {
    void prisma.cSPViolation.create({
      data: {
        directive: normalized.directive,
        blocked: normalized.blocked,
        document: normalized.document,
        userId: userId ?? undefined,
      },
    });
  }
}

export async function POST(request: NextRequest) {
  if (isRateLimited(clientIp(request))) {
    return new NextResponse(null, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  // Get user from session if present
  const session = await getServerSession();
  const user = session?.user?.id ? { id: session.user.id } : undefined;

  // Process all reports (array or single object)
  const reports = Array.isArray(body) ? body : [body];
  for (const report of reports) {
    const normalized = normalizeReport(report);
    if (!normalized) continue;

    await processReport(normalized, user?.id);
  }

  // Return 204 No Content on success
  return new NextResponse(null, { status: 204 });
}

/**
 * GET /api/csp-report/stats
 * 
 * Get aggregated CSP violation statistics for admin monitoring.
 * Requires admin authentication.
 */
export async function GET(request: NextRequest) {
  // Check if this is a stats request
  const url = new URL(request.url);
  if (url.searchParams.get('action') === 'stats') {
    // Require admin access
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const role = (session.user as { role?: string })?.role;
    if (role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const reports = getAggregatedReports();
    return NextResponse.json({
      totalViolations: reports.reduce((sum, r) => sum + r.count, 0),
      uniquePatterns: reports.length,
      reports,
      timestamp: new Date().toISOString(),
    });
  }

  // Regular GET - just return basic info
  return NextResponse.json({
    status: 'ok',
    reportsInMemory: reportAggregates.size,
    timestamp: new Date().toISOString(),
  });
}

/**
 * DELETE /api/csp-report
 * 
 * Clear aggregated reports (admin only).
 */
export async function DELETE(request: NextRequest) {
  const session = await getServerSession();
  const user = requireAuth({ user: session?.user });

  if (user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  clearAggregatedReports();
  return NextResponse.json({ success: true, message: 'Aggregated reports cleared' });
}
