import type { PrismaClient } from '@/lib/generated/prisma/client';

/**
 * GDPR data export service.
 *
 * Assembles a complete copy of all data linked to a user (GDPR Art. 15/20).
 * Secrets, password hashes, tokens and Stellar secret seeds are never included.
 */

// Fields that must never leave the system, regardless of model.
const SENSITIVE_FIELD_PATTERN = /(password|hash|secret|token|seed|privateKey|apiKey|refreshToken|accessToken)/i;

// Models that are internal/operational and not user-owned data.
const EXCLUDED_MODELS = new Set<string>([
  'User', // handled explicitly below
  'Session',
  'Account',
  'VerificationToken',
]);

// Explicit per-model field allow-lists for models where a blanket export
// would leak sensitive columns. Keys are Prisma model names.
const FIELD_DENYLIST: Record<string, string[]> = {
  User: ['passwordHash', 'password', 'twoFactorSecret', 'stellarSecret', 'stellarSecretSeed'],
};

type AnyRecord = Record<string, unknown>;

export interface DataExportResult {
  exportedAt: string;
  user: AnyRecord | null;
  [model: string]: unknown;
}

interface RuntimeField {
  name: string;
  kind: string;
  type: string;
  relationName?: string | null;
}

/**
 * Model/field metadata for introspection. Prisma 7's `prisma-client`
 * generator no longer exports `Prisma.dmmf`; the same metadata ships with
 * the client as its runtime data model (`_runtimeDataModel`).
 */
function getRuntimeModels(prisma: PrismaClient): { name: string; fields: RuntimeField[] }[] {
  const dataModel = (
    prisma as unknown as {
      _runtimeDataModel?: { models: Record<string, { fields: RuntimeField[] }> };
    }
  )._runtimeDataModel;
  if (!dataModel) return [];
  return Object.entries(dataModel.models).map(([name, model]) => ({ name, fields: model.fields }));
}

/**
 * Returns the list of Prisma model names that have a direct relation to User
 * (either a `userId` scalar field or a relation field pointing at User).
 *
 * Introspects the client's runtime data model so newly added models are
 * automatically covered.
 */
export function getUserLinkedModels(prisma: PrismaClient): string[] {
  const models = getRuntimeModels(prisma);
  const linked: string[] = [];

  for (const model of models) {
    if (EXCLUDED_MODELS.has(model.name)) continue;

    const hasUserId = model.fields.some(
      (field) => field.name === 'userId' || field.name === 'user_id',
    );
    const hasUserRelation = model.fields.some(
      (field) =>
        field.kind === 'object' &&
        (field.type === 'User' || field.relationName === 'UserTo' + model.name),
    );

    if (hasUserId || hasUserRelation) {
      linked.push(model.name);
    }
  }

  return linked;
}

function sanitizeRecord(model: string, record: AnyRecord): AnyRecord {
  const denylist = new Set(FIELD_DENYLIST[model] ?? []);
  const clean: AnyRecord = {};

  for (const [key, value] of Object.entries(record)) {
    if (denylist.has(key)) continue;
    if (SENSITIVE_FIELD_PATTERN.test(key)) continue;
    clean[key] = value;
  }

  return clean;
}

/**
 * Builds the full data export for a user. The Prisma client is injected so the
 * logic can be unit-tested without HTTP or a live database.
 */
export async function buildUserDataExport(
  prisma: PrismaClient,
  userId: string,
): Promise<DataExportResult> {
  const result: DataExportResult = {
    exportedAt: new Date().toISOString(),
    user: null,
  };

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return result;
  }

  result.user = sanitizeRecord('User', user as unknown as AnyRecord);

  const models = getUserLinkedModels(prisma);
  const client = prisma as unknown as Record<string, { findMany?: (args: unknown) => Promise<unknown[]> }>;

  for (const modelName of models) {
    const delegate = client[modelName.charAt(0).toLowerCase() + modelName.slice(1)];
    if (!delegate || typeof delegate.findMany !== 'function') continue;

    const rows = (await delegate.findMany({ where: { userId } })) as AnyRecord[];
    result[modelName] = rows.map((row) => sanitizeRecord(modelName, row));
  }

  return result;
}
