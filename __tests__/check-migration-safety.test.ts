import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkMigrations, findDestructiveStatements } from '../scripts/check-migration-safety.mjs';

describe('findDestructiveStatements', () => {
  it('allows additive changes', () => {
    const sql = [
      'CREATE TABLE "Foo" ("id" TEXT NOT NULL);',
      'ALTER TABLE "User" ADD COLUMN "bio" TEXT;',
      'CREATE INDEX "Foo_id_idx" ON "Foo"("id");',
    ].join('\n');
    expect(findDestructiveStatements(sql)).toEqual([]);
  });

  it.each([
    ['DROP TABLE', 'DROP TABLE "Legacy";'],
    ['DROP COLUMN', 'ALTER TABLE "User" DROP COLUMN "bio";'],
    ['RENAME', 'ALTER TABLE "User" RENAME COLUMN "bio" TO "about";'],
    ['ALTER COLUMN TYPE', 'ALTER TABLE "User" ALTER COLUMN "age" SET DATA TYPE BIGINT;'],
    ['SET NOT NULL', 'ALTER TABLE "User" ALTER COLUMN "bio" SET NOT NULL;'],
    ['TRUNCATE', 'TRUNCATE "Session";'],
  ])('flags %s', (rule, sql) => {
    expect(findDestructiveStatements(sql)).toEqual([{ line: 1, rule, text: sql }]);
  });

  it('accepts a contract marker on the line above or inline', () => {
    const sql = [
      '-- migration-safety: contract',
      'ALTER TABLE "User" DROP COLUMN "bio";',
      'DROP TABLE "Legacy"; -- migration-safety: contract',
    ].join('\n');
    expect(findDestructiveStatements(sql)).toEqual([]);
  });

  it('ignores keywords inside comments', () => {
    expect(findDestructiveStatements('-- we used to DROP TABLE here')).toEqual([]);
  });
});

describe('checkMigrations', () => {
  it('skips migrations at or before the baseline', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrations-'));
    const write = (name: string, sql: string) => {
      fs.mkdirSync(path.join(dir, name));
      fs.writeFileSync(path.join(dir, name, 'migration.sql'), sql);
    };
    write('20260101000000_old', 'DROP TABLE "Old";');
    write('20270101000000_new', 'ALTER TABLE "User" DROP COLUMN "bio";');

    const results = checkMigrations(dir, '20261231000000');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ migration: '20270101000000_new', rule: 'DROP COLUMN', line: 1 });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
