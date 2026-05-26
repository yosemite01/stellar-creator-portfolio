/**
 * Spike test — sudden burst of traffic to simulate viral/flash-crowd events.
 * Jumps from idle to peak in seconds, then drops back down.
 *
 * Usage:
 *   k6 run load-tests/spike.test.js
 *
 * Expected duration: ~3 minutes
 */
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { BASE_URL, RUST_API_URL } from './config/options.js';
import { jsonHeaders } from './helpers/auth.js';

export const options = {
  stages: [
    { duration: '10s', target: 5 },    // baseline
    { duration: '10s', target: 200 },  // spike — instant ramp
    { duration: '1m',  target: 200 },  // hold spike
    { duration: '10s', target: 5 },    // drop back
    { duration: '30s', target: 5 },    // recovery observation
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    // Relaxed during spike — we care about survival, not speed
    http_req_duration: ['p(95)<5000', 'p(99)<10000'],
    http_req_failed:   ['rate<0.10'],
    checks:            ['rate>0.85'],
  },
};

const errorRate    = new Rate('spike_errors');
const bountiesP95  = new Trend('spike_bounties_p95');
const creatorsP95  = new Trend('spike_creators_p95');
const rustP95      = new Trend('spike_rust_health_p95');

export default function () {
  group('bounties-spike', () => {
    const r = http.get(`${BASE_URL}/api/bounties?page=1&limit=10`, { headers: jsonHeaders() });
    bountiesP95.add(r.timings.duration);
    const ok = check(r, {
      'spike bounties: not 5xx': (res) => res.status < 500,
    });
    if (!ok) errorRate.add(1);
  });

  group('creators-spike', () => {
    const r = http.get(`${BASE_URL}/api/creators?page=1&limit=10`, { headers: jsonHeaders() });
    creatorsP95.add(r.timings.duration);
    const ok = check(r, {
      'spike creators: not 5xx': (res) => res.status < 500,
    });
    if (!ok) errorRate.add(1);
  });

  group('rust-health-spike', () => {
    const r = http.get(`${RUST_API_URL}/health`);
    rustP95.add(r.timings.duration);
    const ok = check(r, {
      'spike rust health: 200': (res) => res.status === 200,
    });
    if (!ok) errorRate.add(1);
  });

  sleep(0.3);
}
