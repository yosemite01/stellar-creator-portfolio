import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/lib/generated/prisma/client';
import { buildUserDataExport } from '@/lib/user-data-export';

/**
 * Regression test for #1539: the GDPR data export must include every
 * Prisma model that is linked to a User (via a `userId` field or a
 * relation to `User`). If a new user-linked model is added and the
 * export forgets it, this test fails.
 */

const SECRET_FIELDS = new Set([
  'password',
  'passwordHash',
  'hashedPassword',
  'token',
  'tokenHash',
  'refreshToken',
  'secret',
  'secretKey',
  'stellarSecret',
  'stellarSecretSeed',
  'privateKey',
  'apiKey',
]);

interface RuntimeField {
  name: string;
  kind: string;
  type: string;
}

function modelHasUserLink(fields: RuntimeField[]): boolean {
  return fields.some((field) => {
    if (field.name === 'userId') return true;
    if (field.kind === 'object' && field.type === 'User') return true;
    return false;
  });
}

function userLinkedModels(): string[] {
  // Prisma 7's `prisma-client` generator no longer exports Prisma.dmmf; read
  // the runtime data model from a client instance instead. The pg adapter
  // connects lazily, so no database is needed.
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: 'postgresql://localhost/unused' }),
  }) as unknown as {
    _runtimeDataModel: { models: Record<string, { fields: RuntimeField[] }> };
  };
  return Object.entries(client._runtimeDataModel.models)
    .filter(([name, model]) => name !== 'User' && modelHasUserLink(model.fields))
    .map(([name]) => name)
    .sort();
}

function exportKeys(): string[] {
  const payload = buildUserDataExport({
    userId: 'test-user-id',
    records: {},
  });
  return Object.keys(payload).sort();
}

describe('GDPR data export coverage (#1539)', () => {
  it('includes every Prisma model linked to a User', () => {
    const expected = userLinkedModels();
    const keys = exportKeys();

    const missing = expected.filter((model) => !keys.includes(model));
    expect(missing).toEqual([]);
  });

  it('does not leak secret or hash fields', () => {
    const payload = buildUserDataExport({
      userId: 'test-user-id',
      records: {},
    });
    const serialized = JSON.stringify(payload);

    for (const secret of SECRET_FIELDS) {
      expect(serialized).not.toContain(`"${secret}"`);
    }
  });

  it('matches the export key snapshot', () => {
    expect(exportKeys()).toMatchSnapshot();
  });
});
