// Bounded k6 load test (final system verification only — not a permanent
// perf harness; see IMPLEMENTATION_GUIDE.md's k6 mention). Registers a small
// pool of real users against a running API, then mixes representative reads
// with controlled, idempotency-keyed transfers.
//
// Run: k6 run -e BASE_URL=http://host.docker.internal:4000/api/v1 load-test/smoke-load.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000/api/v1';
const POOL_SIZE = 15;
const PASSWORD = 'correct horse battery staple';

// A 429 from the transfer rate limiter is the security control working as
// designed under this load, not a failure — don't let it trip http_req_failed.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }, 429));

export const options = {
  scenarios: {
    smoke_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 30 },
        { duration: '30s', target: 30 },
        { duration: '5s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<800'],
  },
};

const transferErrors = new Counter('transfer_errors');
const transferLatency = new Trend('transfer_duration');

// Simple (non-cryptographic) UUIDv4 — fine for a load-test idempotency key,
// which only needs to be well-formed and unique per attempt.
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function jsonHeaders(extra) {
  return Object.assign({ 'Content-Type': 'application/json' }, extra);
}

function registerUser(email) {
  const csrfRes = http.get(`${BASE_URL}/auth/csrf`);
  const csrfToken = csrfRes.json('data.csrfToken');
  const csrfCookie = `csrf_token=${csrfToken}`;

  const res = http.post(
    `${BASE_URL}/auth/register`,
    JSON.stringify({ email, password: PASSWORD, displayName: email.split('@')[0] }),
    { headers: jsonHeaders({ Cookie: csrfCookie, 'X-CSRF-Token': csrfToken }) },
  );

  if (res.status !== 201) {
    return null;
  }

  const accessCookie = res.cookies['access_token']?.[0]?.value;
  const userId = res.json('data.user.id');

  return {
    userId,
    cookie: `csrf_token=${csrfToken}; access_token=${accessCookie}`,
    csrfToken,
  };
}

// setup() runs once, before any VU iterations — the user pool is shared
// across the whole run rather than registered per-iteration.
export function setup() {
  const users = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    const email = `k6-loadtest-${Date.now()}-${i}@example.test`;
    const user = registerUser(email);
    if (user) {
      users.push(user);
    }
  }

  if (users.length < 2) {
    throw new Error(`Could only register ${users.length} test users — aborting load test.`);
  }

  return { users };
}

export default function (data) {
  const users = data.users;
  const self = users[__VU % users.length];
  const other = users[(__VU + 1) % users.length];

  const authHeaders = { headers: { Cookie: self.cookie } };

  // Representative read mix.
  const wallet = http.get(`${BASE_URL}/wallet`, authHeaders);
  check(wallet, { 'wallet 200': (r) => r.status === 200 });

  const activity = http.get(`${BASE_URL}/activity?limit=10`, authHeaders);
  check(activity, { 'activity 200': (r) => r.status === 200 });

  const search = http.get(`${BASE_URL}/users/search?q=k6-loadtest`, authHeaders);
  check(search, { 'search 200': (r) => r.status === 200 });

  // Controlled financial write: small, fixed amount, real idempotency key.
  const transferRes = http.post(
    `${BASE_URL}/transfers`,
    JSON.stringify({ receiverUserId: other.userId, amountMinor: 100, note: 'k6 load test' }),
    {
      headers: jsonHeaders({
        Cookie: self.cookie,
        'X-CSRF-Token': self.csrfToken,
        'Idempotency-Key': uuidv4(),
      }),
    },
  );
  transferLatency.add(transferRes.timings.duration);
  const transferOk = check(transferRes, {
    'transfer 201 or rate-limited': (r) => r.status === 201 || r.status === 429,
  });
  if (!transferOk) {
    transferErrors.add(1);
  }

  sleep(1);
}
