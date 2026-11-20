/**
 * Audit Logging & Telemetry Service  (#508)
 *
 * Provides:
 *  - writeAuditLog()       — persist a structured audit record
 *  - withAuditLog()        — higher-order wrapper that auto-logs any mutation
 *  - createAuditInterceptor() — Next.js middleware-compatible interceptor
 *  - hashIp()              — one-way IP hashing (no raw PII stored)
 *  - extractTelemetryMeta() — pull trace-id / headers silently from a request
 *
 * Design principles
 *  • Non-blocking: audit writes never throw to the caller; failures are
 *    captured to console (or a future dead-letter queue).
 *  • No raw PII: IP addresses are SHA-256 hashed before persistence.
 *  • Trace correlation: W3C traceparent header is parsed so every audit row
 *    can be joined with distributed traces.
 *  • Payload sanitisation: known secret fields are stripped before storage.
 */

import { prisma } from '@/lib/prisma';
import type { AuditStatus, AuditLog as PrismaAuditLog, Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';

// ── Types ────────────────────────────────────────────────────────────────────

export interface TelemetryMeta {
  traceId: string;
  ipHash: string | null;
  userAgent: string | null;
  geoCountry: string | null;
  httpMethod: string | null;
  requestPath: string | null;
}

export interface AuditLogInput {
  /** Authenticated user ID (undefined = unauthenticated attempt). */
  userId?: string | null;
  /** High-level resource category: "bounty" | "application" | "escrow" | … */
  resource: string;
  /** Specific action: "create" | "update" | "delete" | "accept" | … */
  action: string;
  /** Primary key of the affected record. */
  resourceId?: string | null;
  /**
   * Sanitised mutation payload snapshot.
   * Sensitive fields are stripped automatically — see sanitisePayload().
   */
  payload?: Record<string, unknown> | null;
  /** Outcome; defaults to SUCCESS. */
  status?: AuditStatus;
  /** Error message captured on failure. */
  errorMessage?: string | null;
  /** Telemetry headers extracted from the originating request. */
  meta?: Partial<TelemetryMeta>;
}

/**
 * Before/after snapshot for admin decisions that change money or identity
 * state (dispute resolution, KYC review). Persisted under the `before` and
 * `after` keys of the audit payload so every decision is reconstructable.
 */
export interface AdminDecisionAuditInput {
  /** Admin user ID performing the decision. */
  userId?: string | null;
  /** Resource category, e.g. "dispute" | "kyc". */
  resource: string;
  /** Action, e.g. "resolve" | "review". */
  action: string;
  /** Primary key of the affected record. */
  resourceId?: string | null;
  /** State prior to the decision. */
  before?: Record<string, unknown> | null;
  /** State after the decision. */
  after?: Record<string, unknown> | null;
  /** Telemetry headers extracted from the originating request. */
  meta?: Partial<TelemetryMeta>;
}

/**
 * Audit log entry with hash-chain metadata (from database).
 */
export interface AuditLogEntry extends PrismaAuditLog {
  prevHash: string | null;
  entryHash: string;
  isTampered: boolean;
  anchoredAt: Date | null;
}

/**
 * Hash chain verification result.
 */
export interface AuditChainVerification {
  isValid: boolean;
  tamperedEntries: string[];
  message: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Fields that must never be persisted in the audit payload. */
const SECRET_FIELDS = new Set([
  'password',
  'passwordHash',
  'secret',
  'token',
  'accessToken',
  'refreshToken',
  'privateKey',
  'apiKey',
  'creditCard',
  'cvv',
  'ssn',
]);

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * SHA-256 hash of a raw IP address so we can detect abuse patterns without
 * storing the PII value itself.
 * Returns null when ip is falsy (e.g. behind a proxy that strips headers).
 */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  // Normalise IPv6 mapped IPv4 (e.g. "::ffff:192.168.1.1" → "192.168.1.1")
  const normalised = ip.replace(/^::ffff:/, '').trim();
  return createHash('sha256').update(normalised).digest('hex');
}

/**
 * Recursively strip secret fields from an object before persisting it.
 * Returns a plain JSON-serialisable value.
 */
export function sanitisePayload(
  payload: unknown,
  depth = 0,
): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object' || depth > 5) return null;

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (SECRET_FIELDS.has(key)) {
      result[key] = '[REDACTED]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = sanitisePayload(value, depth + 1);
    } else if (Array.isArray(value)) {
      // Shallow-sanitise array items
      result[key] = value.map((item) =>
        typeof item === 'object' ? sanitisePayload(item, depth + 1) : item,
      );
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Parse the W3C `traceparent` header and return just the trace-id segment.
 * Format: `00-<traceId>-<parentId>-<flags>`
 * Falls back to a freshly generated UUID so every audit row always has a traceId.
 */
export function parseTraceId(traceparent: string | null | undefined): string {
  if (traceparent) {
    const parts = traceparent.split('-');
    // parts[1] is the 32-hex-char trace-id
    if (parts.length >= 2 && /^[0-9a-f]{32}$/i.test(parts[1])) {
      return parts[1];
    }
  }
  // Generate a fallback trace-id in W3C format
  return randomUUID().replace(/-/g, '');
}

/**
 * Extract telemetry metadata silently from a standard Request / NextRequest.
 * Never throws — returns safe defaults on any error.
 */
export function extractTelemetryMeta(
  request: Request | { headers: Headers | { get(name: string): string | null } },
): TelemetryMeta {
  try {
    const headers =
      'headers' in request ? (request.headers as Headers) : new Headers();

    const rawIp =
      headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      headers.get('x-real-ip') ??
      headers.get('cf-connecting-ip') ?? // Cloudflare
      null;

    const traceparent = headers.get('traceparent');
    // Vercel / Cloudflare may inject their own trace header
    const vercelTraceId = headers.get('x-vercel-id') ?? headers.get('cf-ray');

    const traceId = parseTraceId(traceparent ?? vercelTraceId);

    const url = 'url' in request ? (request as Request).url : '';
    const method = 'method' in request ? (request as Request).method : null;

    let requestPath: string | null = null;
    if (url) {
      try {
        requestPath = new URL(url).pathname;
      } catch {
        requestPath = url;
      }
    }

    return {
      traceId,
      ipHash: hashIp(rawIp),
      userAgent: headers.get('user-agent'),
      geoCountry:
        headers.get('cf-ipcountry') ?? // Cloudflare
        headers.get('x-vercel-ip-country') ?? // Vercel
        null,
      httpMethod: method?.toUpperCase() ?? null,
      requestPath,
    };
  } catch {
    return {
      traceId: parseTraceId(null),
      ipHash: null,
      userAgent: null,
      geoCountry: null,
      httpMethod: null,
      requestPath: null,
    };
  }
}

// ── Hash chain helpers ───────────────────────────────────────────────────────

/**
 * Compute SHA-256 hash of audit entry data for hash-chain integrity.
 * The hash includes all entry fields plus the previous entry's hash.
 */
export function computeEntryHash(entry: {
  id: string;
  userId: string | null;
  resource: string;
  action: string;
  resourceId: string | null;
  payload: Prisma.JsonValue | null;
  httpMethod: string | null;
  requestPath: string | null;
  status: AuditStatus;
  errorMessage: string | null;
  traceId: string;
  ipHash: string | null;
  userAgent: string | null;
  geoCountry: string | null;
  createdAt: Date | string;
  prevHash: string | null;
}): string {
  const dataStr = JSON.stringify({
    id: entry.id,
    userId: entry.userId,
    resource: entry.resource,
    action: entry.action,
    resourceId: entry.resourceId,
    payload: entry.payload,
    httpMethod: entry.httpMethod,
    requestPath: entry.requestPath,
    status: entry.status,
    errorMessage: entry.errorMessage,
    traceId: entry.traceId,
    ipHash: entry.ipHash,
    userAgent: entry.userAgent,
    geoCountry: entry.geoCountry,
    createdAt: entry.createdAt.toString(),
    prevHash: entry.prevHash,
  });
  return createHash('sha256').update(dataStr).digest('hex');
}

/**
 * Get the most recent audit log entry (for chaining).
 * Returns null if no entries exist.
 */
async function getLatestEntry(): Promise<string | null> {
  const latest = await prisma.auditLog.findFirst({
    orderBy: { createdAt: 'desc', id: 'desc' },
    select: { entryHash: true },
  });
  return latest?.entryHash ?? null;
}

// ── Core write ───────────────────────────────────────────────────────────────

/**
 * Persist one audit log entry with hash-chain integrity.
 *
 * This function automatically:
 *  - Computes the entry's hash from all fields + previous entry hash
 *  - Sets prevHash to the latest entry's hash (or null for first entry)
 *  - The database trigger prevents tampering with existing entries
 *
 * This function is intentionally fire-and-forget safe: it never throws.
 * Callers that need to await persistence for compliance purposes should
 * `await` the returned promise and handle the null-on-failure return.
 *
 * @returns The created AuditLog record, or null on write failure.
 */
export async function writeAuditLog(
  input: AuditLogInput,
): Promise<{ id: string } | null> {
  try {
    const sanitised = input.payload ? sanitisePayload(input.payload) : null;
    const prevHash = await getLatestEntry();

    const record = await prisma.auditLog.create({
      data: {
        userId: input.userId ?? null,
        resource: input.resource,
        action: input.action,
        resourceId: input.resourceId ?? null,
        payload: (sanitised ?? undefined) as Prisma.InputJsonValue | undefined,
        status: input.status ?? 'SUCCESS',
        errorMessage: input.errorMessage ?? null,
        traceId: input.meta?.traceId ?? parseTraceId(null),
        ipHash: input.meta?.ipHash ?? null,
        userAgent: input.meta?.userAgent ?? null,
        geoCountry: input.meta?.geoCountry ?? null,
        httpMethod: input.meta?.httpMethod ?? null,
        requestPath: input.meta?.requestPath ?? null,
        prevHash: prevHash,
        entryHash: '', // Computed by DB trigger
      },
      select: { id: true },
    });

    return record;
  } catch (err) {
    // Audit failures must never break the primary request path.
    console.error('[AuditLog] Failed to write audit log:', err);
    return null;
  }
}

/**
 * Persist an admin decision (dispute resolution, KYC review) with explicit
 * before/after snapshots. Delegates to writeAuditLog so sanitisation and
 * non-blocking failure semantics are preserved.
 *
 * @returns The created AuditLog record, or null on write failure.
 */
export async function writeAdminDecisionAudit(
  input: AdminDecisionAuditInput,
): Promise<{ id: string } | null> {
  return writeAuditLog({
    userId: input.userId ?? null,
    resource: input.resource,
    action: input.action,
    resourceId: input.resourceId ?? null,
    payload: {
      before: input.before ?? null,
      after: input.after ?? null,
    },
    meta: input.meta,
  });
}

// ── Hash chain verification ──────────────────────────────────────────────────

/**
 * Verify the integrity of the entire audit hash chain.
 * Checks each entry's hash against computed hash and prevHash chain.
 * 
 * @returns Verification result with tampered entry IDs if any found.
 */
export async function verifyAuditChain(): Promise<AuditChainVerification> {
  const entries = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'asc', id: 'asc' },
    select: {
      id: true,
      prevHash: true,
      entryHash: true,
      isTampered: true,
      userId: true,
      resource: true,
      action: true,
      createdAt: true,
    },
  });

  if (entries.length === 0) {
    return { isValid: true, tamperedEntries: [], message: 'No audit entries to verify' };
  }

  const tamperedEntries: string[] = [];
  let prevHash: string | null = null;

  for (const entry of entries) {
    // Check if database marked this entry as tampered
    if (entry.isTampered) {
      tamperedEntries.push(entry.id);
      continue;
    }

    // Verify hash chain continuity
    if (entry.prevHash !== prevHash) {
      tamperedEntries.push(entry.id);
      continue;
    }

    // Verify entry hash integrity (recompute and compare)
    const computedHash = computeEntryHash({
      id: entry.id,
      userId: entry.userId,
      resource: entry.resource,
      action: entry.action,
      resourceId: null,
      payload: null,
      httpMethod: null,
      requestPath: null,
      status: 'SUCCESS', // Default - exact status not in selection
      errorMessage: null,
      traceId: '',
      ipHash: null,
      userAgent: null,
      geoCountry: null,
      createdAt: entry.createdAt,
      prevHash: entry.prevHash,
    });

    if (computedHash !== entry.entryHash) {
      tamperedEntries.push(entry.id);
    }

    prevHash = entry.entryHash;
  }

  if (tamperedEntries.length > 0) {
    return {
      isValid: false,
      tamperedEntries,
      message: `Chain broken: ${tamperedEntries.length} entry(ies) tampered`,
    };
  }

  return { isValid: true, tamperedEntries: [], message: 'Chain verified successfully' };
}

/**
 * Anchor the current chain head hash on Stellar using manage_data operation.
 * This provides cryptographic proof that the chain existed at a specific time.
 * 
 * @param client StellarClient instance
 * @returns Transaction hash if successful, null on failure
 */
export async function anchorChainHeadOnStellar(): Promise<string | null> {
  try {
    const { stellarClient } = await import('@/server/stellar/client');
    
    const headEntry = await prisma.auditLog.findFirst({
      orderBy: { createdAt: 'desc', id: 'desc' },
      select: { entryHash: true },
    });

    if (!headEntry) {
      console.warn('[Audit] No entries to anchor on Stellar');
      return null;
    }

    const adminSecret = stellarClient.config.adminSecret;
    if (!adminSecret) {
      console.warn('[Audit] No Stellar admin secret configured; skipping anchor');
      return null;
    }
    const { Keypair, Operation, TransactionBuilder } = await import('@stellar/stellar-sdk');
    const keypair = Keypair.fromSecret(adminSecret);
    const account = await stellarClient.rpc.getAccount(keypair.publicKey());

    // Use manage_data to store the hash as a data entry
    const tx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: stellarClient.config.networkPassphrase,
    })
      .addOperation(Operation.manageData({
        name: 'audit_chain_head',
        value: headEntry.entryHash.substring(0, 64), // Stellar data values max 64 bytes
      }))
      .setTimeout(180)
      .build();

    tx.sign(keypair);
    const result = await stellarClient.rpc.sendTransaction(tx);

    // Accepted by the RPC (PENDING) or already submitted (DUPLICATE).
    if (result.status === 'PENDING' || result.status === 'DUPLICATE') {
      // Update the entry with anchoring timestamp
      await prisma.auditLog.update({
        where: { entryHash: headEntry.entryHash },
        data: { anchoredAt: new Date() },
      });
      return result.hash;
    }

    return null;
  } catch (err) {
    console.error('[Audit] Failed to anchor chain on Stellar:', err);
    return null;
  }
}

// ── Mutation interceptor / wrapper ───────────────────────────────────────────

export interface MutationContext {
  userId?: string | null;
  resource: string;
  action: string;
  resourceId?: string | null;
  request?: Request | { headers: Headers | { get(name: string): string | null } };
}

/**
 * Higher-order wrapper that:
 

/* … truncated 4158 chars — edit only what you need near the top … */
