const { call, login, uniq, cleaner } = require('../harness');

/**
 * The same role name in two branches, with different rules.
 *
 * A shop hand can work in more than one branch, and each branch sets its own
 * manager loose on different things. The role stored on the user record is
 * only where they started: what they may do has to be decided by the branch
 * they are working in at that moment, on the server as well as in the UI.
 */
module.exports = {
  name: 'office-based permissions',
  async run({ ok, token, office, offices }) {
    const other = offices.find((o) => o.id !== office);
    if (!other) {
      ok('a second office exists', false, 'seed one to run this suite');
      return;
    }

    const clean = cleaner(call, token);
    const s = uniq();
    const name = `E2E Branch Hand ${s}`;

    // the same role name in both branches — this is how the app seeds roles
    const roleHere = await call('/roles', {
      method: 'POST',
      token,
      body: { role: name, description: 'e2e: per-office rules', office_id: office },
    });
    const roleThere = await call('/roles', {
      method: 'POST',
      token,
      body: { role: name, description: 'e2e: per-office rules', office_id: other.id },
    });
    ok(
      'the same role name can exist in two branches',
      roleHere.status === 201 && roleThere.status === 201,
      `${roleHere.status}/${roleThere.status}`,
    );
    if (roleHere.status !== 201 || roleThere.status !== 201) return;

    const hereId = roleHere.json.data.id ?? roleHere.json.data._id;
    const thereId = roleThere.json.data.id ?? roleThere.json.data._id;
    clean.delete(`/roles/${hereId}`);
    clean.delete(`/roles/${thereId}`);

    // here they may read products but not expenses; there it is the other way
    await call(`/access/${hereId}`, {
      method: 'PUT',
      token,
      body: {
        permissions: [
          { module: 'products', view: true, create: false, edit: false, delete: false },
          { module: 'expenses', view: false, create: false, edit: false, delete: false },
        ],
      },
    });
    await call(`/access/${thereId}`, {
      method: 'PUT',
      token,
      body: {
        permissions: [
          { module: 'products', view: false, create: false, edit: false, delete: false },
          { module: 'expenses', view: true, create: false, edit: false, delete: false },
        ],
      },
    });

    const email = `e2e.branch${s}@codex.com`;
    const created = await call('/staff', {
      method: 'POST',
      token,
      body: {
        first_name: 'E2E',
        last_name: 'Branch',
        email,
        password: 'Tester@123456',
        mobile_no: '03009876543',
        cnic_no: `35201-${String(s).slice(-7)}-3`,
        address: 'Test street',
        salary: 0,
        // the role of the first branch; the user works in both
        role_id: hereId,
        office_ids: [office, other.id],
      },
    });
    ok('a user in two branches is created', created.status === 201, JSON.stringify(created.json)?.slice(0, 200));
    if (created.status !== 201) return;
    clean.delete(`/staff/${created.json.data.id}`);

    const userToken = await login(email, 'Tester@123456');
    ok('the user can sign in', !!userToken);

    // --- what the UI is told
    const here = (
      await call(`/profile/permissions?office_id=${office}`, { token: userToken })
    ).json?.data;
    ok(
      'their own permissions can be read without access-control rights',
      !!here?.permissions?.length,
      JSON.stringify(here)?.slice(0, 200),
    );
    ok(
      'in their own branch the matrix is that branch\'s',
      here?.permissions?.find((p) => p.module === 'products')?.view === true &&
        here?.permissions?.find((p) => p.module === 'expenses')?.view === false,
      JSON.stringify(here?.permissions?.filter((p) => ['products', 'expenses'].includes(p.module))),
    );
    ok('the branch is named back', here?.office_id === office, here?.office_id);

    const there = (
      await call(`/profile/permissions?office_id=${other.id}`, { token: userToken })
    ).json?.data;
    ok(
      'in the other branch the same role name resolves to that branch\'s rules',
      there?.permissions?.find((p) => p.module === 'products')?.view === false &&
        there?.permissions?.find((p) => p.module === 'expenses')?.view === true,
      JSON.stringify(there?.permissions?.filter((p) => ['products', 'expenses'].includes(p.module))),
    );
    ok(
      'the role id follows the branch, not the user record',
      there?.role_id === thereId && here?.role_id === hereId,
      `${here?.role_id}/${there?.role_id} vs ${hereId}/${thereId}`,
    );
    ok('the role name stays the same in both', here?.role === there?.role && here?.role === name);
    ok('neither branch makes them an admin', here?.is_admin === false && there?.is_admin === false);

    // --- and what the API actually allows
    ok(
      'products can be read in the branch that allows it',
      (await call(`/products?office_id=${office}`, { token: userToken })).status === 200,
    );
    ok(
      'products are refused in the branch that does not',
      (await call(`/products?office_id=${other.id}`, { token: userToken })).status === 403,
    );
    ok(
      'expenses are allowed in the branch that grants them',
      (await call(`/expenses?office_id=${other.id}`, { token: userToken })).status === 200,
    );
    ok(
      'expenses are refused in the branch that does not',
      (await call(`/expenses?office_id=${office}`, { token: userToken })).status === 403,
    );

    // --- a branch they do not work in answers with their own branch, not that one
    const outsider = (
      await call(`/profile/permissions?office_id=${'0'.repeat(24)}`, { token: userToken })
    ).json?.data;
    ok(
      'an office they are not assigned to does not grant anything',
      outsider?.office_id !== '0'.repeat(24),
      JSON.stringify(outsider?.office_id),
    );

    // --- changing one branch's matrix does not touch the other
    await call(`/access/${thereId}`, {
      method: 'PUT',
      token,
      body: {
        permissions: [
          { module: 'products', view: true, create: true, edit: false, delete: false },
          { module: 'expenses', view: true, create: false, edit: false, delete: false },
        ],
      },
    });
    const afterEdit = (
      await call(`/profile/permissions?office_id=${other.id}`, { token: userToken })
    ).json?.data;
    const stillHere = (
      await call(`/profile/permissions?office_id=${office}`, { token: userToken })
    ).json?.data;
    ok(
      'granting in one branch takes effect there at once',
      afterEdit?.permissions?.find((p) => p.module === 'products')?.create === true,
      JSON.stringify(afterEdit?.permissions?.find((p) => p.module === 'products')),
    );
    ok(
      'and leaves the other branch exactly as it was',
      stillHere?.permissions?.find((p) => p.module === 'products')?.create === false &&
        stillHere?.permissions?.find((p) => p.module === 'expenses')?.view === false,
      JSON.stringify(stillHere?.permissions?.filter((p) => ['products', 'expenses'].includes(p.module))),
    );
    ok(
      'the newly granted action works against the API too',
      (await call(`/products?office_id=${other.id}`, { token: userToken })).status === 200,
    );

    await clean.run();
  },
};
