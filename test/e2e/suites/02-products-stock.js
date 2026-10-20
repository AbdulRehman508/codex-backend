const { call, uniq, cleaner } = require('../harness');

/**
 * The product is where stock lives, so this covers the fields that drive the
 * rest of the system (reorder level, unit, pack size) and every way stock is
 * corrected by hand.
 */
module.exports = {
  name: 'products & stock adjustments',
  async run({ ok, token, office }) {
    const clean = cleaner(call, token);
    const s = uniq();
    const qty = async (id) =>
      (await call(`/products/${id}?office_id=${office}`, { token })).json?.data?.quantity;

    const created = await call('/products', {
      method: 'POST',
      token,
      body: {
        office_id: office,
        name: `E2E Item ${s}`,
        sku: `E2E-${s}`,
        price: 200,
        quantity: 50,
        min_stock: 8,
        unit: 'carton',
        pack_size: 12,
        status: 'active',
      },
    });
    ok('product created', created.status === 201, JSON.stringify(created.json));
    const product = created.json.data;
    clean.delete(`/products/${product.id}`);

    ok(
      'reorder level, unit and pack size are stored',
      product.min_stock === 8 && product.unit === 'carton' && product.pack_size === 12,
      JSON.stringify({ m: product.min_stock, u: product.unit, p: product.pack_size }),
    );
    ok('cost price starts at zero', product.cost_price === 0, String(product.cost_price));

    // --- sku is unique inside an office
    const dupe = await call('/products', {
      method: 'POST',
      token,
      body: { office_id: office, name: 'dupe', sku: `E2E-${s}`, price: 1 },
    });
    ok('a duplicate SKU in the same office is refused', dupe.status === 409, String(dupe.status));

    // --- adjustments
    const inc = await call('/stock/adjustments', {
      method: 'POST',
      token,
      body: {
        office_id: office,
        product_id: product.id,
        type: 'increase',
        reason: 'found',
        quantity: 10,
        note: 'found a carton',
      },
    });
    ok('stock increase accepted', inc.status === 201, JSON.stringify(inc.json));
    ok(
      'the entry records before and after',
      inc.json?.data?.before_quantity === 50 && inc.json?.data?.after_quantity === 60,
      JSON.stringify(inc.json?.data),
    );
    ok('stock is 60', (await qty(product.id)) === 60);

    await call('/stock/adjustments', {
      method: 'POST',
      token,
      body: {
        office_id: office,
        product_id: product.id,
        type: 'decrease',
        reason: 'damaged',
        quantity: 15,
      },
    });
    ok('stock is 45 after a write-off', (await qty(product.id)) === 45);

    const tooMuch = await call('/stock/adjustments', {
      method: 'POST',
      token,
      body: {
        office_id: office,
        product_id: product.id,
        type: 'decrease',
        reason: 'lost',
        quantity: 999,
      },
    });
    ok('removing more than is held is refused', tooMuch.status === 400, String(tooMuch.status));
    ok('the error names the field', !!tooMuch.json?.errors?.quantity, JSON.stringify(tooMuch.json));
    ok('stock is untouched after the refusal', (await qty(product.id)) === 45);

    // --- recount replaces the figure in either direction
    const down = await call('/stock/adjustments', {
      method: 'POST',
      token,
      body: {
        office_id: office,
        product_id: product.id,
        type: 'recount',
        reason: 'correction',
        quantity: 40,
      },
    });
    ok(
      'a recount down to 40 records the 5 unit gap',
      down.json?.data?.after_quantity === 40 && down.json?.data?.quantity === 5,
      JSON.stringify(down.json?.data),
    );
    ok('stock is 40', (await qty(product.id)) === 40);

    const noop = await call('/stock/adjustments', {
      method: 'POST',
      token,
      body: {
        office_id: office,
        product_id: product.id,
        type: 'recount',
        reason: 'correction',
        quantity: 40,
      },
    });
    ok('a recount that changes nothing is refused', noop.status === 400, String(noop.status));

    const unknown = await call('/stock/adjustments', {
      method: 'POST',
      token,
      body: {
        office_id: office,
        product_id: '000000000000000000000000',
        type: 'increase',
        reason: 'found',
        quantity: 1,
      },
    });
    ok(
      'an unknown product is refused with a field error',
      unknown.status === 400 && !!unknown.json?.errors?.product_id,
      JSON.stringify(unknown.json),
    );

    // --- the ledger reads back
    const list = await call(
      `/stock/adjustments?office_id=${office}&product_id=${product.id}&limit=20`,
      { token },
    );
    ok(
      'the ledger lists the three entries that went through',
      list.json?.data?.total === 3,
      String(list.json?.data?.total),
    );
    ok(
      'units in and out are totalled (10 + 0 in, 15 + 5 out)',
      list.json?.data?.summary?.units_in === 10 && list.json?.data?.summary?.units_out === 20,
      JSON.stringify(list.json?.data?.summary),
    );
    ok(
      'filtering by reason works',
      (await call(
        `/stock/adjustments?office_id=${office}&product_id=${product.id}&reason=damaged`,
        { token },
      )).json?.data?.total === 1,
    );

    await clean.run();
  },
};
