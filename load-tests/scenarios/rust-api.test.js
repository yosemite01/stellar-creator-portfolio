/**
 * Load test — Rust backend API (port 3001)
 * Covers: health, bounties, freelancers, escrow
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { RUST_API_URL, averageLoadOptions, defaultThresholds } from '../config/options.js';

export const options = {
  ...averageLoadOptions,
  thresholds: defaultThresholds,
};

const healthLatency     = new Trend('rust_health_duration');
const bountiesLatency   = new Trend('rust_bounties_duration');
const freelancerLatency = new Trend('rust_freelancers_duration');

const DISCIPLINES = ['design', 'development', 'writing'];

export default function () {
  // --- GET /health ---
  const healthRes = http.get(`${RUST_API_URL}/health`);
  healthLatency.add(healthRes.timings.duration);
  check(healthRes, {
    'rust health: status 200': (r) => r.status === 200,
  });

  sleep(0.3);

  // --- GET /api/bounties ---
  const bountiesRes = http.get(`${RUST_API_URL}/api/bounties`);
  bountiesLatency.add(bountiesRes.timings.duration);
  check(bountiesRes, {
    'rust bounties list: status 200': (r) => r.status === 200,
  });

  sleep(0.3);

  // --- POST /api/bounties (create) ---
  const createBountyRes = http.post(
    `${RUST_API_URL}/api/bounties`,
    JSON.stringify({
      creator:     `GLOAD${__VU}TESTER${__ITER}STELLAR`,
      title:       `Load Test Bounty ${__VU}-${__ITER}`,
      description: 'Automated load test — safe to delete.',
      budget:      1000,
      deadline:    Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(createBountyRes, {
    'rust create bounty: status 200 or 201': (r) =>
      r.status === 200 || r.status === 201,
  });

  sleep(0.5);

  // --- GET /api/freelancers ---
  const discipline = DISCIPLINES[__ITER % DISCIPLINES.length];
  const freelancersRes = http.get(
    `${RUST_API_URL}/api/freelancers?discipline=${discipline}`,
  );
  freelancerLatency.add(freelancersRes.timings.duration);
  check(freelancersRes, {
    'rust freelancers list: status 200': (r) => r.status === 200,
  });

  sleep(0.5);

  // --- POST /api/freelancers/register ---
  const registerRes = http.post(
    `${RUST_API_URL}/api/freelancers/register`,
    JSON.stringify({
      name:       `Load Tester ${__VU}-${__ITER}`,
      discipline: discipline,
      bio:        'Automated load test profile.',
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(registerRes, {
    'rust register freelancer: status 200 or 201 or 409': (r) =>
      [200, 201, 409].includes(r.status),
  });

  sleep(1);
}
