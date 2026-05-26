/**
 * Load test — Analytics API
 * Covers: all presets, granularities, and export formats
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { BASE_URL, averageLoadOptions, defaultThresholds } from '../config/options.js';
import { jsonHeaders } from '../helpers/auth.js';

export const options = {
  ...averageLoadOptions,
  thresholds: {
    ...defaultThresholds,
    // Analytics can be heavier — allow more latency
    http_req_duration: ['p(95)<1000', 'p(99)<3000'],
  },
};

const analyticsLatency = new Trend('analytics_duration');

const PRESETS      = ['7d', '30d', '90d', '1y'];
const GRANULARITY  = ['daily', 'weekly', 'monthly'];

export default function () {
  const preset      = PRESETS[__ITER % PRESETS.length];
  const granularity = GRANULARITY[__ITER % GRANULARITY.length];

  // --- JSON response ---
  const jsonRes = http.get(
    `${BASE_URL}/api/analytics?preset=${preset}&granularity=${granularity}&format=json`,
    { headers: jsonHeaders() },
  );
  analyticsLatency.add(jsonRes.timings.duration);
  check(jsonRes, {
    'analytics json: status 200': (r) => r.status === 200,
    'analytics json: has body':   (r) => r.body.length > 0,
  });

  sleep(1);

  // --- CSV export ---
  const csvRes = http.get(
    `${BASE_URL}/api/analytics?preset=${preset}&format=csv`,
    { headers: jsonHeaders() },
  );
  check(csvRes, {
    'analytics csv: status 200': (r) => r.status === 200,
  });

  sleep(1);
}
