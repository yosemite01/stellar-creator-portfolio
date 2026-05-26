#!/usr/bin/env node
/**
 * Translation management: ensure every locale file has the same keys as `en.json`
 * (fails CI if coverage drops below threshold).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.join(__dirname, '..', 'public', 'locales');
const BASE = 'en';
const MIN_COVERAGE = 0.9;

function flattenKeys(obj, prefix = '') {
  const keys = [];
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return keys;
  }
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flattenKeys(v, p));
    } else {
      keys.push(p);
    }
  }
  return keys.sort();
}

function loadLocale(code) {
  const fp = path.join(LOCALES_DIR, `${code}.json`);
  const raw = fs.readFileSync(fp, 'utf8');
  return JSON.parse(raw);
}

function main() {
  const files = fs.readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json'));
  const codes = files.map((f) => f.replace('.json', ''));
  if (!codes.includes(BASE)) {
    console.error(`Missing base locale ${BASE}.json`);
    process.exit(1);
  }

  const baseKeys = new Set(flattenKeys(loadLocale(BASE)));
  let worst = 1;

  for (const code of codes) {
    if (code === BASE) continue;
    const keys = new Set(flattenKeys(loadLocale(code)));
    let present = 0;
    for (const k of baseKeys) {
      if (keys.has(k)) present += 1;
    }
    const coverage = baseKeys.size === 0 ? 1 : present / baseKeys.size;
    worst = Math.min(worst, coverage);
    const missing = [...baseKeys].filter((k) => !keys.has(k));
    const extra = [...keys].filter((k) => !baseKeys.has(k));
    if (missing.length || extra.length) {
      console.error(`\n[${code}] key parity vs ${BASE}:`);
      if (missing.length) console.error('  missing:', missing.slice(0, 20), missing.length > 20 ? '...' : '');
      if (extra.length) console.error('  extra:', extra.slice(0, 20), extra.length > 20 ? '...' : '');
    }
    if (coverage < MIN_COVERAGE) {
      console.error(`\n[${code}] coverage ${(coverage * 100).toFixed(1)}% < ${MIN_COVERAGE * 100}%`);
      process.exit(1);
    }
  }

  console.log(
    `i18n: ${codes.length} locale files; ${baseKeys.size} keys in ${BASE}; worst-case parity vs ${BASE}: ${(worst * 100).toFixed(1)}%`,
  );
}

main();
