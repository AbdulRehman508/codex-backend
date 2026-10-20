const { BASE, call, uniq } = require('../harness');

/**
 * The session lives in an httpOnly cookie, so a script injected into the page
 * cannot read it. A bearer header still works, because Swagger, this suite
 * and any non-browser client need one.
 */
module.exports = {
  name: 'session cookie & headers',
  async run({ ok, token, office }) {
    const email = process.env.API_EMAIL || 'admin@codex.com';
    const password = process.env.API_PASSWORD || 'Admin@123456';

    // --- login hands back a cookie, not just a body
    const res = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const setCookie = res.headers.get('set-cookie') ?? '';
    ok('login sets a session cookie', setCookie.includes('codex_token'), setCookie.slice(0, 120));
    ok('the cookie is httpOnly', /httponly/i.test(setCookie), setCookie.slice(0, 160));
    ok('the cookie is SameSite', /samesite/i.test(setCookie), setCookie.slice(0, 160));
    ok('the cookie is scoped to the whole app', /path=\//i.test(setCookie), setCookie.slice(0, 160));

    const cookie = setCookie.split(';')[0];

    // --- the cookie alone authenticates, with no Authorization header
    const withCookie = await fetch(`${BASE}/products?office_id=${office}`, {
      headers: { Cookie: cookie },
    });
    ok('the cookie alone authenticates a call', withCookie.status === 200, String(withCookie.status));

    // --- and nothing authenticates without either
    const naked = await fetch(`${BASE}/products?office_id=${office}`);
    ok('no cookie and no header is refused', naked.status === 401, String(naked.status));

    // --- the bearer header still works
    ok(
      'a bearer token still works',
      (await call(`/products?office_id=${office}`, { token })).status === 200,
    );

    // --- logout clears it
    const loggedOut = await fetch(`${BASE}/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    const cleared = loggedOut.headers.get('set-cookie') ?? '';
    ok(
      'logout clears the cookie',
      cleared.includes('codex_token') && /expires=thu, 01 jan 1970|max-age=0/i.test(cleared),
      cleared.slice(0, 160),
    );

    // --- security headers
    const headers = (await fetch(`${BASE}/products?office_id=${office}`, { headers: { Cookie: cookie } }))
      .headers;
    const csp = headers.get('content-security-policy') ?? '';
    ok('the API sends a content security policy', csp.includes("default-src 'none'"), csp.slice(0, 120));
    ok('and refuses to be framed', (headers.get('x-frame-options') ?? '').toUpperCase() === 'SAMEORIGIN' ||
      csp.includes("frame-ancestors 'none'"), headers.get('x-frame-options') ?? csp.slice(0, 80));
    ok(
      'content type sniffing is off',
      headers.get('x-content-type-options') === 'nosniff',
      String(headers.get('x-content-type-options')),
    );

    // --- the docs still render, so the looser policy for them took effect
    const docs = await fetch(`${BASE}/docs`, { redirect: 'follow' });
    const docsCsp = docs.headers.get('content-security-policy') ?? '';
    ok('the Swagger UI is still reachable', docs.status === 200, String(docs.status));
    ok(
      'the docs get their own, looser policy',
      docsCsp.includes("script-src 'self' 'unsafe-inline'"),
      docsCsp.slice(0, 140),
    );

    // a unique value, so a failed run never collides on a later one
    void uniq();
  },
};
