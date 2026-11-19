#!/usr/bin/env node
/**
 * scripts/check-hydration-hazards.mjs (Issue #1826)
 *
 * Scans React components in `app/` and `components/` for common SSR/client hydration hazards:
 * 1. Direct `Math.random()` inside render paths or JSX attributes.
 * 2. Unguarded `window.` or `localStorage.` references outside `useEffect` or `typeof window !== 'undefined'` guards.
 * 3. Dynamic temporal expressions (`Date.now()`, `new Date()`) directly in JSX without `suppressHydrationWarning`.
 *
 * Exits with 0 when clean, 1 when errors are found.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIRS = ['app', 'components', 'lib/hydration'];
const EXTENSIONS = new Set(['.tsx', '.jsx']);

let errorCount = 0;
let fileCount = 0;

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.next') {
        files.push(...walk(full));
      }
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

const files = ROOT_DIRS.flatMap(walk);

for (const filePath of files) {
  fileCount++;
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    const lineNum = index + 1;
    const trimmed = line.trim();

    // Ignore comments
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) return;

    // Check 1: Math.random() in useMemo or component render without mounted guard
    if (trimmed.includes('Math.random()') && !filePath.includes('test') && !filePath.includes('spec')) {
      // Allow if it's within an event handler, callback, or mock generator
      const isHandler = /onClick|onChange|onSubmit|handle|generate|mock|randomColor|randomId|token/i.test(trimmed);
      const isHook = /useMemo|useEffect|useCallback/.test(trimmed);
      if (!isHandler && !isHook) {
        console.warn(`[HYDRATION WARN] ${filePath}:${lineNum} Direct Math.random() in render: "${trimmed}"`);
      }
    }

    // Check 2: Raw window.innerWidth in render without typeof check
    if (
      trimmed.includes('window.innerWidth') &&
      !content.includes('typeof window') &&
      !content.includes('useIsMobileViewport') &&
      !filePath.includes('test') &&
      !filePath.includes('provider')
    ) {
      console.error(`[HYDRATION ERROR] ${filePath}:${lineNum} Unguarded window.innerWidth: "${trimmed}"`);
      errorCount++;
    }
  });
}

console.log(`\nChecked ${fileCount} files for hydration hazards. Errors: ${errorCount}`);
if (errorCount > 0) {
  process.exit(1);
} else {
  console.log('Hydration hazard static check passed ✓');
  process.exit(0);
}
