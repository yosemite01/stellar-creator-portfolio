/**
 * Load test — Reviews API (Rust service, /api/v1)
 * Covers: list a creator's reviews, list all reviews, submit a review
 * Target: RUST_API_URL (backend/services/api), not the Next.js app.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { RUST_API_URL, defaultThresholds } from '../config/options.js';
import { jsonHeaders } from '../helpers/auth.js';

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

// Creator ids to read and review (the seeded creators by default). Override
// with real ids via CREATOR_IDS (comma-separated) for representative results.
const CREATOR_IDS = (__ENV.CREATOR_IDS || 'alex-studio').split(',');
// Reviews belong to a completed bounty; point BOUNTY_ID at one in the target
// environment.
const BOUNTY_ID = __ENV.BOUNTY_ID || 'load-test-bounty';

export default function () {
  const creator = CREATOR_IDS[__ITER % CREATOR_IDS.length];

  // --- GET /api/v1/creators/:id/reviews ---
  const listRes = http.get(
    `${RUST_API_URL}/api/v1/creators/${creator}/reviews?sortBy=createdAt&sortOrder=desc&page=1&limit=10`,
    { headers: jsonHeaders() },
  );
  listLatency.add(listRes.timings.duration);
  check(listRes, {
    'creator reviews: status 200': (r) => r.status === 200,
  });

  // --- GET /api/v1/reviews (all reviews, filtered) ---
  const allRes = http.get(
    `${RUST_API_URL}/api/v1/reviews?minRating=3&page=1&limit=10`,
    { headers: jsonHeaders() },
  );
  check(allRes, {
    'all reviews: status 200': (r) => r.status === 200,
  });

  sleep(1);

  // --- POST /api/v1/reviews (submit) ---
  const createRes = http.post(
    `${RUST_API_URL}/api/v1/reviews`,
    JSON.stringify({
      bountyId: BOUNTY_ID,
      creatorId: creator,
      rating: 4,
      title: 'Load test review',
      body: 'Automated load-test review. Please disregard.',
      reviewerName: 'k6',
    }),
    { headers: jsonHeaders() },
  );
  createLatency.add(createRes.timings.duration);
  check(createRes, {
    'reviews create: accepted or rate-limited': (r) =>
      [200, 201, 429].includes(r.status),
  });

  sleep(2);
}
