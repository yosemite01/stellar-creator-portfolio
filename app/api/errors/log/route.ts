import { NextRequest, NextResponse } from 'next/server';
import { checkRate, resetRate } from '@/server/api/rate-limit';

const MAX_PAYLOAD_BYTES = 8 * 1024;
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
const SAMPLE_RATE = 0.1;

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const STELLAR_SECRET_RE = /S[A-Z2-7]{55}/g;
const TOKEN_RE = /\b(?:bearer\s+)?[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/gi;

function redact(value: string): string {
  return value
    .replace(STELLAR_SECRET_RE, '[REDACTED_STELLAR_SECRET]')
    .replace(TOKEN_RE, '[REDACTED_TOKEN]')
    .replace(EMAIL_RE, '[REDACTED_EMAIL]');
}

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

function hashStack(stack: string): string {
  let h = 0;
  for (let i = 0; i < stack.length; i++) {
    h = (h * 31 + stack.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

const seenStacks = new Map<string, number>();

function shouldSample(stackKey: string): boolean {
  const now = Date.now();
  const last = seenStacks.get(stackKey);
  if (last && now - last < RATE_WINDOW_MS) {
    return Math.random() < SAMPLE_RATE;
  }
  seenStacks.set(stackKey, now);
  if (seenStacks.size > 1000) {
    for (const [k, t] of seenStacks) {
      if (now - t >= RATE_WINDOW_MS) seenStacks.delete(k);
    }
  }
  return true;
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const rateKey = `error-report:${ip}`;
  const rate = checkRate(rateKey, RATE_LIMIT, RATE_WINDOW_MS / 1000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfter) } },
    );
  }

  const raw = await req.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_PAYLOAD_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid report' }, { status: 400 });
  }

  const report = body as Record<string, unknown>;
  if (typeof report.id !== 'string' || typeof report.level !== 'string' || typeof report.message !== 'string') {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const stack = typeof report.stack === 'string' ? report.stack : '';
  const stackKey = hashStack(stack || report.message);
  if (!shouldSample(stackKey)) {
    return NextResponse.json({ ok: true, sampled: false }, { status: 202 });
  }

  const safe = {
    id: report.id,
    level: report.level,
    message: redact(report.message),
    stack: stack ? redact(stack) : undefined,
    context: report.context ? redact(JSON.stringify(report.context)) : undefined,
  };

  console.error(`[client-error] ${JSON.stringify(safe)}`);
  return NextResponse.json({ ok: true }, { status: 202 });
}
