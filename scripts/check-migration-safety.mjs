#!/usr/bin/env node
/**
 * Expand/contract lint for Prisma migrations (#1762).
 *
 * During a rolling deploy the previous app release keeps running against the
 * new schema, so a migration must not drop, rename or narrow anything the old
 * release still reads. Destructive statements belong in a later "contract"
 * migration, shipped only after no running release uses the old shape, and
 * must be marked with `-- migration-safety: contract` on the line above.
 *
 * Migrations at or before BASELINE were written before this policy and are
 * not checked. See prisma/MIGRATIONS.md.
 *
 * Usage: node scripts/check-migration-safety.mjs [migrationsDir]
 */
import fs from 'node:fs';
import path from 'node:path';

export const BASELINE = '20261120100002';
export const ALLOW_MARKER = /--\s*migration-safety:\s*contract\b/i;

export const RULES = [
  { name: 'DROP TABLE', pattern: /\bDROP\s+TABLE\b/i },
  { name: 'DROP COLUMN', pattern: /\bDROP\s+COLUMN\b/i },
  { name: 'RENAME', pattern: /\bRENAME\s+(COLUMN\b|TO\b)/i },
  { name: 'ALTER COLUMN TYPE', pattern: /\bALTER\s+COLUMN\s+"?\w+"?\s+(SET\s+DATA\s+)?TYPE\b/i },
  { name: 'SET NOT NULL', pattern: /\bSET\s+NOT\s+NULL\b/i },
  { name: 'DROP TYPE', pattern: /\bDROP\s+TYPE\b/i },
  { name: 'TRUNCATE', pattern: /\bTRUNCATE\b/i },
];

/** Returns `{ line, rule, text }` for each unmarked destructive statement. */
export function findDestructiveStatements(sql) {
  const lines = sql.split(/\r?\n/);
  const findings = [];
  lines.forEach((text, i) => {
    const code = text.replace(/--.*$/, '');
    for (const rule of RULES) {
      if (!rule.pattern.test(code)) continue;
      const allowed = ALLOW_MARKER.test(text) || (i > 0 && ALLOW_MARKER.test(lines[i - 1]));
      if (!allowed) findings.push({ line: i + 1, rule: rule.name, text: text.trim() });
    }
  });
  return findings;
}

/** Checks every migration folder newer than BASELINE. */
export function checkMigrations(dir, baseline = BASELINE) {
  const results = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const file = path.join(dir, name, 'migration.sql');
    if (name.slice(0, 14) <= baseline || !fs.existsSync(file)) continue;
    for (const f of findDestructiveStatements(fs.readFileSync(file, 'utf8'))) {
      results.push({ migration: name, ...f });
    }
  }
  return results;
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const dir = process.argv[2] ?? path.resolve('prisma/migrations');
  const results = checkMigrations(dir);
  for (const r of results) {
    console.error(`::error file=prisma/migrations/${r.migration}/migration.sql,line=${r.line}::${r.rule} is not expand-safe: ${r.text}`);
  }
  if (results.length > 0) {
    console.error('Move destructive changes to a contract migration and mark them with "-- migration-safety: contract" (see prisma/MIGRATIONS.md).');
    process.exit(1);
  }
  console.log('Migration safety: no unmarked destructive statements.');
}
