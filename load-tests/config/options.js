/**
 * Shared k6 options and thresholds for all load test scenarios.
 */

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
export const RUST_API_URL = __ENV.RUST_API_URL || 'http://localhost:3001';

/** Standard thresholds applied to every scenario */
export const defaultThresholds = {
  // 95% of requests must complete within 500ms
  http_req_duration: ['p(95)<500', 'p(99)<1000'],
  // Error rate must stay below 1%
  http_req_failed: ['rate<0.01'],
  // At least 95% of custom checks must pass
  checks: ['rate>0.95'],
};

/** Light load — baseline / smoke */
export const smokeOptions = {
  vus: 5,
  duration: '30s',
  thresholds: defaultThresholds,
};

/** Average load — normal production traffic */
export const averageLoadOptions = {
  stages: [
    { duration: '30s', target: 20 },   // ramp up
    { duration: '1m',  target: 20 },   // steady state
    { duration: '20s', target: 0 },    // ramp down
  ],
  thresholds: defaultThresholds,
};

/** Stress — push beyond expected peak */
export const stressOptions = {
  stages: [
    { duration: '30s', target: 50 },
    { duration: '1m',  target: 100 },
    { duration: '30s', target: 150 },
    { duration: '1m',  target: 150 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000', 'p(99)<5000'],
    http_req_failed:   ['rate<0.05'],
    checks:            ['rate>0.90'],
  },
};

/** Soak — sustained load to detect memory leaks / degradation */
export const soakOptions = {
  stages: [
    { duration: '2m',  target: 30 },
    { duration: '30m', target: 30 },
    { duration: '2m',  target: 0 },
  ],
  thresholds: defaultThresholds,
};
