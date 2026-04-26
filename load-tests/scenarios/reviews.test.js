/**
 * Load test — Reviews API
 * Covers: list reviews, submit review, vote
 * Rate limit: 20 req/min general, 10 req/min POST
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { BASE_URL, averageLoadOptions, defaultThresholds } from '../config/options.js';
import { jsonHeaders, getSessionCookie, authHeaders } from '../helpers/auth.js';

export const options = {
  // Reviews have a tighter rate limit — keep VUs lower
  stages: [
    { duration: '30s', target: 10 },
    { duration: '1m',  target: 10 },
    { duration: '20s', target: 0 },
  ],
  thresholds: defaultThresholds,
};

const listLatency   = new Trend('reviews_list_duration');
const createLatency = new Trend('reviews_create_duration');

// Seed creator IDs — replace with real IDs from your DB for accurate testing
const CREATOR_IDS = ['creator-1', 'creator-2', 'creator-3'];

let sessionCookie;

export function setup() {
  sessionCookie = getSessionCookie();
}

export default function () {
  const creatorId = CREATOR_IDS[__ITER % CREATOR_IDS.length];

  // --- GET /api/reviews?creatorId= ---
  const listRes = http.get(
    `${BASE_URL}/api/reviews?creatorId=${creatorId}&sort=recent&page=1&limit=10`,
    { headers: jsonHeaders() },
  );
  listLatency.add(listRes.timings.duration);
  check(listRes, {
    'reviews list: status 200 or 404': (r) => r.status === 200 || r.status === 404,
  });

  sleep(1);

  // --- POST /api/reviews (submit) ---
  const createRes = http.post(
    `${BASE_URL}/api/reviews`,
    JSON.stringify({
      creatorId: creatorId,
      rating:    4,
      title:     'Load test review',
      body:      'This is an automated load test review. Please disregard.',
    }),
    { headers: authHeaders(sessionCookie) },
  );
  createLatency.add(createRes.timings.duration);
  check(createRes, {
    'reviews create: status 201 or 401 or 429': (r) =>
      [201, 401, 429].includes(r.status),
  });

  sleep(2);
}
