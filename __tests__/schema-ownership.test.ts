import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Issue #1754: Schema Ownership & Single Migration Authority', () => {
  const schemaPath = path.resolve(__dirname, '../prisma/schema.prisma');
  const schemaContent = fs.readFileSync(schemaPath, 'utf-8');

  it('declares canonical Prisma schema models', () => {
    expect(schemaContent).toContain('model User');
    expect(schemaContent).toContain('model CreatorProfile');
    expect(schemaContent).toContain('model Bounty');
    expect(schemaContent).toContain('model Review');
  });

  it('has documented system of record architecture and migration policy', () => {
    const docPath = path.resolve(__dirname, '../docs/SYSTEM_OF_RECORD.md');
    expect(fs.existsSync(docPath)).toBe(true);
    const docContent = fs.readFileSync(docPath, 'utf-8');
    expect(docContent).toContain('Prisma ORM is designated as the sole, authoritative System of Record');
  });
});
