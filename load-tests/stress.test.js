/**
 * Stress test — ramp VUs well beyond expected peak to find the breaking point.
 * Targets the most critical read paths (bounties, creators, analytics).
 *
 * Usage:
 *   k6 run load-tests/stress.test.js
 */
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { BASE_URL, RUST_API_URL, stressOptions } from './config/options.js';
import { jsonHeaders } from './helpers/auth.js';

export const options = stressOptions;

const errorRate      = new Rate('stress_errors');
const bountiesP95    = new Trend('stress_bounties_p95');
const creatorsP95    = new Trend('stress_creators_p95');
const analyticsP95   = new Trend('stress_analytics_p95');
const rustHealthP95  = new Trend('stress_rust_health_p95');

export default function () {
  group('bounties-read', () => {
    const r = http.get(`${BASE_URL}/api/bounties?page=1&limit=10`, { headers: jsonHeaders() });
    bountiesP95.add(r.timings.duration);
    const ok = check(r, {
      'stress bounties: not 5xx': (res) => res.status < 500,
      'stress bounties: not 429': (res) => res.status !== 429,
    });
    if (!ok) errorRate.add(1);
  });

  group('creators-read', () => {
    const r = http.get(`${BASE_URL}/api/creators?page=1&limit=10`, { headers: jsonHeaders() });
    creatorsP95.add(r.timings.duration);
    const ok = check(r, {
      'stress creators: not 5xx': (res) => res.status < 500,
    });
    if (!ok) errorRate.add(1);
  });

  group('analytics-read', () => {
    const r = http.get(`${BASE_URL}/api/analytics?preset=30d&format=json`, { headers: jsonHeaders() });
    analyticsP95.add(r.timings.duration);
    const ok = check(r, {
      'stress analytics: not 5xx': (res) => res.status < 500,
    });
    if (!ok) errorRate.add(1);
  });

  group('rust-health', () => {
    const r = http.get(`${RUST_API_URL}/health`);
    rustHealthP95.add(r.timings.duration);
    const ok = check(r, {
      'stress rust health: 200': (res) => res.status === 200,
    });
    if (!ok) errorRate.add(1);
  });

  sleep(0.5);
}
