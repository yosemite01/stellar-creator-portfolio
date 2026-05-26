/**
 * Smoke test — quick sanity check across ALL services.
 * Run this first to verify the environment is up before heavier tests.
 *
 * Usage:
 *   k6 run load-tests/smoke.test.js
 *   k6 run -e BASE_URL=https://staging.example.com load-tests/smoke.test.js
 */
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { BASE_URL, RUST_API_URL, smokeOptions } from './config/options.js';
import { jsonHeaders } from './helpers/auth.js';

export const options = smokeOptions;

export default function () {
  // ── Next.js API routes ──────────────────────────────────────────────────

  group('bounties', () => {
    const r = http.get(`${BASE_URL}/api/bounties?page=1&limit=5`, { headers: jsonHeaders() });
    check(r, { 'bounties: 200': (res) => res.status === 200 });
  });

  group('creators', () => {
    const r = http.get(`${BASE_URL}/api/creators?page=1&limit=5`, { headers: jsonHeaders() });
    check(r, { 'creators: 200': (res) => res.status === 200 });
  });

  group('users', () => {
    const r = http.get(`${BASE_URL}/api/users?page=1&limit=5`, { headers: jsonHeaders() });
    check(r, { 'users: 200': (res) => res.status === 200 });
  });

  group('analytics', () => {
    const r = http.get(`${BASE_URL}/api/analytics?preset=7d&format=json`, { headers: jsonHeaders() });
    check(r, { 'analytics: 200': (res) => res.status === 200 });
  });

  group('reviews', () => {
    const r = http.get(`${BASE_URL}/api/reviews?creatorId=creator-1&page=1&limit=5`, { headers: jsonHeaders() });
    check(r, { 'reviews: 200 or 404': (res) => res.status === 200 || res.status === 404 });
  });

  // ── Rust backend ────────────────────────────────────────────────────────

  group('rust-health', () => {
    const r = http.get(`${RUST_API_URL}/health`);
    check(r, { 'rust health: 200': (res) => res.status === 200 });
  });

  group('rust-bounties', () => {
    const r = http.get(`${RUST_API_URL}/api/bounties`);
    check(r, { 'rust bounties: 200': (res) => res.status === 200 });
  });

  group('rust-freelancers', () => {
    const r = http.get(`${RUST_API_URL}/api/freelancers`);
    check(r, { 'rust freelancers: 200': (res) => res.status === 200 });
  });

  sleep(1);
}
