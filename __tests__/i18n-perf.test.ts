import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { flattenMessageKeys } from '@/lib/i18n';

describe('i18n performance', () => {
  it('parses and flattens locale bundles quickly', () => {
    const dir = join(process.cwd(), 'public/locales');
    const start = performance.now();
    for (let i = 0; i < 10; i += 1) {
      const raw = readFileSync(join(dir, 'en.json'), 'utf8');
      const data = JSON.parse(raw) as Record<string, unknown>;
      flattenMessageKeys(data);
    }
    const ms = performance.now() - start;
    expect(ms).toBeLessThan(500);
  });
});
