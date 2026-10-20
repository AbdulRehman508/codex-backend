const { call, uniq, cleaner, round2 } = require('../harness');

/**
 * The reports an owner actually reads: margin on what sold, who owes whom,
 * what the shelves are worth at cost, and the day's close-out.
 */
module.exports = {
  name: 'reports & day close',
  async run({ ok, token, office }) {
    const clean = cleaner(call, token);
    const s = uniq();
    const tz = 'Asia/Karachi';

    const supplier = (
      await call('/suppliers', {
        method: 'POST',
        token,
        body: { office_id: office, name: `E2E Rep Supplier ${s}`, mobile_no: `0301${String(s).slice(-7)}` },
      })
    ).json.data;
    clean.delete(`/suppliers/${supplier.id}`);

    const product = (
      await call('/products', {
        method: 'POST',
        token,
        body: {
          office_id: office,
          name: `E2E Margin ${s}`,
          sku: `MGN-${s}`,
          price: 500,
          quantity: 0,
          min_stock: 8,
          status: 'active',
        },
      })
    ).json.data;
    clean.delete(`/products/${product.id}`);

    const dayBefore = (
      await call(`/reports/day-close?office_id=${office}&tz=${encodeURIComponent(tz)}`, { token })
    ).json.data;

    // buy 20 @ 300, sell 5 @ 500
    const purchase = (
      await call('/purchases', {
        method: 'POST',
        token,
        body: {
          office_id: office,
          supplier_id: supplier.id,
          status: 'received',
          paid_amount: 2000,
          lines: [{ product_id: product.id, quantity: 20, cost_price: 300 }],
        },
      })
    ).json.data;
    const sale = await call('/sales', {
      method: 'POST',
      token,
      body: {
        office_id: office,
        customer_name: 'Walk-in',
        payment_method: 'cash',
        lines: [{ product_id: product.id, quantity: 5, price: 500 }],
      },
    });
    ok('setup sale recorded', sale.status === 201, JSON.stringify(sale.json)?.slice(0, 160));

    // --- item-wise margin
    const items = await call(
      `/reports/products?office_id=${office}&search=${encodeURIComponent(`E2E Margin ${s}`)}&limit=10`,
      { token },
    );
    const row = items.json?.data?.data?.find((r) => r.product_id === product.id);
    ok('the sold item appears in the item-wise report', !!row, JSON.stringify(items.json?.data?.data)?.slice(0, 200));
    ok(
      'revenue 2500, cost 1500, profit 1000, margin 40%',
      row?.revenue === 2500 && row?.cost === 1500 && row?.profit === 1000 && row?.margin === 40,
      JSON.stringify(row),
    );
    ok(
      'sorting by profit is accepted',
      (await call(`/reports/products?office_id=${office}&sort=profit&order=desc&limit=5`, { token })).status === 200,
    );

    // --- stock at cost, and the per-product reorder level
    const stock = await call(
      `/reports/stock?office_id=${office}&search=${encodeURIComponent(`E2E Margin ${s}`)}&limit=5`,
      { token },
    );
    const stockRow = stock.json?.data?.data?.find((r) => r.id === product.id);
    ok(
      'the stock report values the shelf at cost (15 x 300)',
      stockRow?.cost_value === 4500 && stockRow?.min_stock === 8,
      JSON.stringify(stockRow),
    );
    ok('the summary carries a cost value', typeof stock.json?.data?.summary?.cost_value === 'number');
    ok(
      '15 in stock against a reorder level of 8 is not low',
      !(await call(`/reports/stock?office_id=${office}&search=${encodeURIComponent(`E2E Margin ${s}`)}&low_only=true`, {
        token,
      })).json?.data?.data?.some((r) => r.id === product.id),
    );
    await call('/stock/adjustments', {
      method: 'POST',
      token,
      body: { office_id: office, product_id: product.id, type: 'recount', reason: 'correction', quantity: 6 },
    });
    ok(
      'dropping under the reorder level flags it',
      !!(await call(`/reports/stock?office_id=${office}&search=${encodeURIComponent(`E2E Margin ${s}`)}&low_only=true`, {
        token,
      })).json?.data?.data?.some((r) => r.id === product.id),
    );

    // --- payables
    const payables = await call(
      `/reports/payables?office_id=${office}&search=${encodeURIComponent(`E2E Rep Supplier ${s}`)}&limit=10`,
      { token },
    );
    const pRow = payables.json?.data?.data?.find((r) => r.id === supplier.id);
    ok(
      'payables shows what is owed and what was bought in the period',
      pRow?.payable_amount === 4000 && pRow?.purchased_in_period === 6000,
      JSON.stringify(pRow),
    );
    await call(`/suppliers/${supplier.id}/payments`, { method: 'POST', token, body: { amount: 1500 } });
    const paidRow = (
      await call(
        `/reports/payables?office_id=${office}&search=${encodeURIComponent(`E2E Rep Supplier ${s}`)}&limit=10`,
        { token },
      )
    ).json?.data?.data?.find((r) => r.id === supplier.id);
    ok(
      'a payment shows up as paid in the period',
      paidRow?.paid_in_period === 1500 && paidRow?.payable_amount === 2500,
      JSON.stringify(paidRow),
    );

    // --- day close
    const day = (
      await call(`/reports/day-close?office_id=${office}&tz=${encodeURIComponent(tz)}`, { token })
    ).json.data;
    ok('the day close names its day and timezone', /^\d{4}-\d{2}-\d{2}$/.test(day?.date) && day?.tz === tz);
    ok(
      'every block is present',
      !!day?.sales && !!day?.payments && !!day?.purchases && !!day?.stock && !!day?.cash_drawer,
      JSON.stringify(Object.keys(day ?? {})),
    );
    ok(
      'net sales rose by the 2500 just sold',
      round2(day.sales.net - dayBefore.sales.net) === 2500,
      `${dayBefore.sales.net} -> ${day.sales.net}`,
    );
    ok(
      'cash taken rose by 2500',
      round2(day.payments.cash - dayBefore.payments.cash) === 2500,
      `${dayBefore.payments.cash} -> ${day.payments.cash}`,
    );
    ok(
      'supplier payments rose by 1500',
      round2(day.purchases.supplier_payments - dayBefore.purchases.supplier_payments) === 1500,
    );
    ok(
      'the drawer is cash in less cash out',
      day.cash_drawer.expected === round2(day.cash_drawer.in - day.cash_drawer.out),
      JSON.stringify(day.cash_drawer),
    );

    const yesterday = await call(
      `/reports/day-close?office_id=${office}&tz=${encodeURIComponent(tz)}&date=${new Date(Date.now() - 86400000)
        .toISOString()
        .slice(0, 10)}`,
      { token },
    );
    ok("today's bills are not in yesterday's sheet", yesterday.json?.data?.sales?.net !== day.sales.net);

    // --- cleanup: unwind in the order that keeps the guards happy
    await call(`/sales/${sale.json.data.id}`, { method: 'DELETE', token });
    await call(`/purchases/${purchase.id}`, { method: 'DELETE', token });
    const left = (await call(`/suppliers/${supplier.id}?office_id=${office}`, { token })).json?.data;
    if (left?.payable_amount > 0) {
      await call(`/suppliers/${supplier.id}/payments`, {
        method: 'POST',
        token,
        body: { amount: left.payable_amount },
      });
    }
    await clean.run();
  },
};
