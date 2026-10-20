const { call, login, uniq, cleaner } = require('../harness');

/**
 * Access control is enforced on the server, not in the UI. A cashier who
 * crafts the request by hand must get the same answer as one who never sees
 * the button.
 */
module.exports = {
  name: 'security & permissions',
  async run({ ok, token, office }) {
    const clean = cleaner(call, token);
    const s = uniq();

    // --- unauthenticated
    ok('a call with no token is refused', (await call('/products')).status === 401);
    ok(
      'a call with a nonsense token is refused',
      (await call('/products', { token: 'not-a-token' })).status === 401,
    );
    // 400 (bad body) or 429 (rate limited) both prove it was reached without a
    // token; 401 would mean the route had been gated by mistake
    const publicLogin = await call('/auth/login', { method: 'POST', body: {} });
    ok(
      'login itself stays public',
      [400, 429].includes(publicLogin.status),
      String(publicLogin.status),
    );

    // A role of its own, so the checks do not depend on what the shop has
    // granted its real Manager or Cashier.
    const role = await call('/roles', {
      method: 'POST',
      token,
      body: { role: `E2E Nobody ${s}`, description: 'e2e: no permissions at all', office_id: office },
    });
    ok('a role with no permissions created', role.status === 201, JSON.stringify(role.json));
    if (role.status !== 201) return;
    const roleId = role.json.data.id ?? role.json.data._id;
    clean.delete(`/roles/${roleId}`);

    const email = `e2e.cashier${s}@codex.com`;
    const created = await call('/staff', {
      method: 'POST',
      token,
      body: {
        first_name: 'E2E',
        last_name: 'Cashier',
        email,
        password: 'Tester@123456',
        mobile_no: '03001234567',
        cnic_no: `35202-${String(s).slice(-7)}-1`,
        address: 'Test street',
        salary: 0,
        role_id: roleId,
        office_ids: [office],
      },
    });
    ok('test user created', created.status === 201, JSON.stringify(created.json));
    if (created.status !== 201) return;
    clean.delete(`/staff/${created.json.data.id}`);

    const userToken = await login(email, 'Tester@123456');
    ok('the test user can sign in', !!userToken);

    // the matrix is empty, so every gated module is closed
    const denied = await call(`/products?office_id=${office}`, { token: userToken });
    ok('a module with no permission is refused (403)', denied.status === 403, String(denied.status));
    ok(
      'creating is refused too',
      (await call('/products', {
        method: 'POST',
        token: userToken,
        body: { office_id: office, name: 'x', sku: `X-${s}`, price: 1 },
      })).status === 403,
    );

    // --- admin-only corners
    ok(
      'the audit trail is admin only',
      (await call('/audit-logs', { token: userToken })).status === 403,
    );
    ok('the trash is admin only', (await call('/trash', { token: userToken })).status === 403);

    // --- office scoping
    const offices = (await call('/offices?limit=5', { token })).json.data.data;
    const other = offices.find((o) => o.id !== office);
    if (other) {
      const across = await call(`/products?office_id=${other.id}`, { token: userToken });
      ok(
        'an office the user is not assigned to is refused',
        across.status === 403,
        String(across.status),
      );
    }

    // --- the admin still gets through
    ok(
      'an admin reaches a gated module',
      (await call(`/products?office_id=${office}`, { token })).status === 200,
    );

    await clean.run();
  },
};
