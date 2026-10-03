/**
 * Load test — Bounties (tRPC)
 * Covers: bounties.list (first page, cursor page, budget filter) and,
 *         when API_JWT is set, bounties.create.
 *
 * The web app serves bounties through tRPC at /api/trpc/<procedure>; there
 * is no REST /api/bounties list. Queries are plain GETs with the input as
 * JSON in ?input=. bounties.create is a protected procedure that expects a
 * bearer JWT, so the create step only runs when API_JWT is provided.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { BASE_URL, averageLoadOptions, defaultThresholds } from '../config/options.js';
import { jsonHeaders } from '../helpers/auth.js';

export const options = {
  ...averageLoadOptions,
  thresholds: defaultThresholds,
};

const listLatency   = new Trend('bounties_list_duration');
const createLatency = new Trend('bounties_create_duration');

const API_JWT = __ENV.API_JWT || '';

function trpcQuery(procedure, input) {
  return http.get(
    `${BASE_URL}/api/trpc/${procedure}?input=${encodeURIComponent(JSON.stringify(input))}`,
    { headers: jsonHeaders() },
  );
}

export default function () {
  // --- bounties.list: first page ---
  const listRes = trpcQuery('bounties.list', { take: 10 });
  listLatency.add(listRes.timings.duration);
  check(listRes, {
    'bounties list: status 200': (r) => r.status === 200,
    'bounties list: has bounties': (r) => Array.isArray(r.json('result.data.bounties')),
  });

  // --- bounties.list: next page via cursor ---
  const nextCursor = listRes.status === 200 ? listRes.json('result.data.nextCursor') : null;
  if (nextCursor) {
    const pageRes = trpcQuery('bounties.list', { take: 10, cursor: nextCursor });
    check(pageRes, { 'bounties cursor page: status 200': (r) => r.status === 200 });
  }

  sleep(0.5);

  // --- bounties.list: status + budget filter ---
  const filteredRes = trpcQuery('bounties.list', {
    take: 10,
    status: 'OPEN',
    budget_min: 100,
    budget_max: 5000,
  });
  check(filteredRes, {
    'bounties filtered: status 200': (r) => r.status === 200,
  });

  sleep(0.5);

  // --- bounties.create (needs a JWT) ---
  if (API_JWT) {
    const createRes = http.post(
      `${BASE_URL}/api/trpc/bounties.create`,
      JSON.stringify({
        title:       `Load Test Bounty ${__VU}-${__ITER}`,
        description: 'Automated load test bounty — safe to delete.',
        budget:      500,
        deadline:    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        category:    'development',
        tags:        ['load-test'],
        difficulty:  'intermediate',
      }),
      { headers: jsonHeaders(API_JWT) },
    );
    createLatency.add(createRes.timings.duration);
    check(createRes, {
      'bounties create: status 200': (r) => r.status === 200,
    });
  }

  sleep(1);
}
