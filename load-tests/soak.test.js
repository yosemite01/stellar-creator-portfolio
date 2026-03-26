/**
 * Soak test — sustained moderate load over 30+ minutes.
 * Detects memory leaks, connection pool exhaustion, and gradual degradation.
 *
 * Usage:
 *   k6 run load-tests/soak.test.js
 *
 * Expected duration: ~34 minutes
 */
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { BASE_URL, RUST_API_URL, soakOptions } from './config/options.js';
import { jsonHeaders, getSessionCookie, authHeaders } from './helpers/auth.js';

export const options = soakOptions;

const degradationRate = new Rate('soak_degradation');
const p95Trend        = new Trend('soak_p95_over_time');

let sessionCookie;

export function setup() {
  sessionCookie = getSessionCookie();
}

export default function () {
  // Mix of read and write operations to simulate real traffic

  group('read-bounties', () => {
    const r = http.get(`${BASE_URL}/api/bounties?page=1&limit=10`, { headers: jsonHeaders() });
    p95Trend.add(r.timings.duration);
    const ok = check(r, { 'soak bounties: 200': (res) => res.status === 200 });
    if (!ok) degradationRate.add(1);
  });

  sleep(0.5);

  group('read-creators', () => {
    const r = http.get(`${BASE_URL}/api/creators?page=1&limit=10`, { headers: jsonHeaders() });
    p95Trend.add(r.timings.duration);
    const ok = check(r, { 'soak creators: 200': (res) => res.status === 200 });
    if (!ok) degradationRate.add(1);
  });

  sleep(0.5);

  group('read-analytics', () => {
    const r = http.get(`${BASE_URL}/api/analytics?preset=7d&format=json`, { headers: jsonHeaders() });
    p95Trend.add(r.timings.duration);
    const ok = check(r, { 'soak analytics: 200': (res) => res.status === 200 });
    if (!ok) degradationRate.add(1);
  });

  sleep(0.5);

  group('rust-health', () => {
    const r = http.get(`${RUST_API_URL}/health`);
    p95Trend.add(r.timings.duration);
    const ok = check(r, { 'soak rust health: 200': (res) => res.status === 200 });
    if (!ok) degradationRate.add(1);
  });

  sleep(0.5);

  // Occasional write to simulate realistic mixed traffic
  if (__ITER % 5 === 0) {
    group('write-bounty', () => {
      const r = http.post(
        `${BASE_URL}/api/bounties`,
        JSON.stringify({
          title:       `Soak Test Bounty ${__VU}-${__ITER}`,
          description: 'Soak test — safe to delete.',
          budget:      100,
          deadline:    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          category:    'development',
          difficulty:  'beginner',
        }),
        { headers: authHeaders(sessionCookie) },
      );
      check(r, {
        'soak create bounty: not 5xx': (res) => res.status < 500,
      });
    });
  }

  sleep(1);
}
