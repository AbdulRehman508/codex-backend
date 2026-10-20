const { call, uniq, sleep, cleaner } = require('../harness');

/**
 * The owner's safety net: a record of who changed what, and a way back for a
 * record deleted by mistake.
 */
module.exports = {
  name: 'audit trail & trash',
  async run({ ok, token, office }) {
    const clean = cleaner(call, token);
    const s = uniq();
    const name = `E2E Audit ${s}`;
    const sku = `AUD-${s}`;

    const created = await call('/products', {
      method: 'POST',
      token,
      body: { office_id: office, name, sku, price: 10, quantity: 3, status: 'active' },
    });
    const product = created.json.data;
    await call(`/products/${product.id}`, { method: 'PATCH', token, body: { price: 20 } });
    await call(`/products/${product.id}?office_id=${office}`, { token }); // a read: must not be logged

    // the trail is written after the response, so give it a moment
    await sleep(700);

    // --- audit
    const log = await call(`/audit-logs?search=${encodeURIComponent(name)}&limit=50`, { token });
    ok('the audit trail reads', log.status === 200, JSON.stringify(log.json)?.slice(0, 160));
    const rows = log.json?.data?.data ?? [];
    ok('the create was recorded', rows.some((r) => r.action === 'create' && r.entity_label === name));
    ok('the update was recorded', rows.some((r) => r.action === 'update'));
    ok('no GET was recorded', !rows.some((r) => r.method === 'GET'), JSON.stringify(rows.map((r) => r.method)));

    const entry = rows.find((r) => r.action === 'create');
    ok('the entry names the user', !!entry?.user_email, JSON.stringify(entry)?.slice(0, 200));
    ok('the entry carries the module and the record', entry?.module === 'products' && entry?.entity_id === product.id);
    ok(
      'no token text is ever stored',
      !JSON.stringify(rows).includes('eyJ'),
      'a JWT would start with eyJ',
    );
    ok(
      'filtering by action works',
      (await call('/audit-logs?action=delete&limit=5', { token })).json?.data?.data?.every(
        (r) => r.action === 'delete',
      ),
    );

    // --- trash
    await call(`/products/${product.id}`, { method: 'DELETE', token });
    const bin = await call(`/trash?office_id=${office}&search=${encodeURIComponent(name)}&limit=50`, { token });
    const binned = bin.json?.data?.data?.find((r) => r.id === product.id);
    ok('a deleted product lands in the trash', !!binned, JSON.stringify(bin.json?.data?.data)?.slice(0, 200));
    ok('the row says what kind it is and when it went', binned?.module === 'products' && !!binned?.deleted_at);
    ok(
      'it is gone from the live list',
      (await call(`/products?office_id=${office}&search=${encodeURIComponent(name)}`, { token })).json?.data
        ?.total === 0,
    );

    // a live record holding the same SKU blocks the restore
    const clash = (
      await call('/products', {
        method: 'POST',
        token,
        body: { office_id: office, name: `Clash ${s}`, sku, price: 10, quantity: 0, status: 'active' },
      })
    ).json.data;
    const refused = await call(`/trash/products/${product.id}/restore`, { method: 'POST', token });
    ok('restoring onto a taken SKU is refused', refused.status === 409, String(refused.status));
    ok('the message names the clashing value', String(refused.json?.message ?? '').includes(sku));

    await call(`/products/${clash.id}`, { method: 'DELETE', token });
    const restored = await call(`/trash/products/${product.id}/restore`, { method: 'POST', token });
    ok('it restores once the clash is gone', [200, 201].includes(restored.status), String(restored.status));
    const back = await call(`/products/${product.id}?office_id=${office}`, { token });
    ok('the product reads normally again, stock intact', back.status === 200 && back.json?.data?.quantity === 3);

    // --- a sale is reversed, never restored
    const sale = (
      await call('/sales', {
        method: 'POST',
        token,
        body: {
          office_id: office,
          customer_name: 'Walk-in',
          payment_method: 'cash',
          lines: [{ product_id: product.id, quantity: 1, price: 20 }],
        },
      })
    ).json.data;
    await call(`/sales/${sale.id}`, { method: 'DELETE', token });
    ok(
      'sales never appear in the trash',
      !(await call(`/trash?office_id=${office}&limit=200`, { token })).json?.data?.data?.some((r) => r.id === sale.id),
    );
    const saleRestore = await call(`/trash/sales/${sale.id}/restore`, { method: 'POST', token });
    ok(
      'restoring a sale is refused with an explanation',
      saleRestore.status === 400 && String(saleRestore.json?.message ?? '').includes('reversed'),
      JSON.stringify(saleRestore.json)?.slice(0, 200),
    );

    // --- purge is final
    await call(`/products/${product.id}`, { method: 'DELETE', token });
    ok(
      'a purge removes it for good',
      (await call(`/trash/products/${product.id}`, { method: 'DELETE', token })).status === 200,
    );
    ok(
      'the record is really gone',
      (await call(`/products/${product.id}?office_id=${office}`, { token })).status === 404,
    );
    ok(
      'purging twice says not found',
      (await call(`/trash/products/${product.id}`, { method: 'DELETE', token })).status === 404,
    );

    await call(`/trash/products/${clash.id}`, { method: 'DELETE', token });
    await clean.run();
  },
};
