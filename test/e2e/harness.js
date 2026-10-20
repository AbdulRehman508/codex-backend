/**
 * Shared plumbing for the end-to-end suites.
 *
 * These run against a real, running API — they are the tests that would have
 * caught a broken stock guard or a renamed field, which unit tests on their
 * own cannot. Point them at a disposable database: they create and remove
 * their own records, but a failure mid-run can leave a few behind.
 */
const BASE = process.env.API_BASE || 'http://localhost:3000/api';
const EMAIL = process.env.API_EMAIL || 'admin@codex.com';
const PASSWORD = process.env.API_PASSWORD || 'Admin@123456';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One HTTP call. Never throws on a non-2xx — the suites assert on status. */
async function call(path, { method = 'GET', token, body, raw } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // an empty or non-JSON body is a valid answer for some routes
  }
  return raw ? { status: res.status, json, res } : { status: res.status, json };
}

/**
 * Sign in. Credential routes are rate limited to 5/min, so a suite run that
 * trips the limit waits it out instead of failing with a misleading 429.
 */
async function login(email = EMAIL, password = PASSWORD) {
  let res = await call('/auth/login', { method: 'POST', body: { email, password } });
  for (let i = 0; res.status === 429 && i < 12; i++) {
    await sleep(10_000);
    res = await call('/auth/login', { method: 'POST', body: { email, password } });
  }
  if (res.status !== 200) {
    throw new Error(
      `cannot sign in as ${email}: ${res.status} ${JSON.stringify(res.json)}`,
    );
  }
  return res.json.data.token;
}

/** Collects the assertions of one suite. */
function recorder(name) {
  const results = { name, pass: 0, fail: 0, failures: [] };

  /** Assert. `detail` is printed only when it fails, so keep it cheap. */
  const ok = (label, condition, detail = '') => {
    if (condition) {
      results.pass++;
      if (process.env.E2E_VERBOSE) console.log('    PASS', label);
    } else {
      results.fail++;
      results.failures.push({ label, detail: String(detail).slice(0, 300) });
      console.log('    FAIL', label, detail ? `— ${String(detail).slice(0, 300)}` : '');
    }
  };

  return { results, ok };
}

/** Unique-enough suffix so repeated runs never collide on a unique index. */
const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

/** yyyy-MM-dd, `days` from today, in local time. */
function dateIn(days = 0) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Removes whatever a suite created, in reverse order, ignoring failures —
 * cleanup must never mask the real assertion failure.
 */
function cleaner(call, token) {
  const jobs = [];
  return {
    /** `after(() => call('/products/x', { method: 'DELETE', token }))` */
    after: (fn) => jobs.push(fn),
    delete: (path) => jobs.push(() => call(path, { method: 'DELETE', token })),
    async run() {
      for (const job of jobs.reverse()) {
        try {
          await job();
        } catch {
          // best effort
        }
      }
    },
  };
}

module.exports = { BASE, call, login, recorder, uniq, dateIn, round2, sleep, cleaner };
