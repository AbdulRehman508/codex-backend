const { call, uniq, cleaner, round2 } = require('../harness');

/**
 * Selling: stock comes off, tax is applied the way the branch is configured,
 * credit lands on the customer, and an oversell is impossible even when two
 * tills try at once.
 */
module.exports = {
  name: 'sales, tax & credit',
  async run({ ok, token, office }) {
    const clean = cleaner(call, token);
    const s = uniq();
    const qty = async (id) =>
      (await call(`/products/${id}?office_id=${office}`, { token })).json?.data?.quantity;

    const before = (await call(`/offices/${office}`, { token })).json.data;
    // whatever the branch is set to now is restored at the end
    clean.after(() =>
      call(`/offices/${office}`, {
        method: 'PATCH',
        token,
        body: {
          tax_enabled: before.tax_enabled ?? false,
          tax_name: before.tax_name ?? 'Tax',
          tax_rate: before.tax_rate ?? 0,
          tax_inclusive: before.tax_inclusive ?? false,
          tax_number: before.tax_number ?? '',
        },
      }),
    );

    const product = (
      await call('/products', {
        method: 'POST',
        token,
        body: {
          office_id: office,
          name: `E2E Sell ${s}`,
          sku: `SELL-${s}`,
          price: 1000,
          quantity: 100,
          status: 'active',
        },
      })
    ).json.data;
    clean.delete(`/products/${product.id}`);

    const sell = (body) =>
      call('/sales', {
        method: 'POST',
        token,
        body: { office_id: office, customer_name: 'Walk-in', payment_method: 'cash', ...body },
      });

    // --- tax off
    await call(`/offices/${office}`, { method: 'PATCH', token, body: { tax_enabled: false } });
    const plain = await sell({ lines: [{ product_id: product.id, quantity: 1, price: 1000 }] });
    ok(
      'with tax off the bill is just the lines',
      plain.json?.data?.total === 1000 && plain.json?.data?.tax_amount === 0,
      JSON.stringify({ t: plain.json?.data?.total, x: plain.json?.data?.tax_amount }),
    );
    clean.delete(`/sales/${plain.json.data.id}`);
    ok('stock came off', (await qty(product.id)) === 99);

    // --- tax on top
    await call(`/offices/${office}`, {
      method: 'PATCH',
      token,
      body: { tax_enabled: true, tax_name: 'GST', tax_rate: 17, tax_inclusive: false, tax_number: `TN-${s}` },
    });
    const excl = await sell({ lines: [{ product_id: product.id, quantity: 2, price: 1000 }] });
    const e = excl.json.data;
    clean.delete(`/sales/${e.id}`);
    ok(
      'exclusive: 2000 net + 340 tax = 2340',
      e.subtotal === 2000 && e.tax_amount === 340 && e.total === 2340,
      JSON.stringify({ s: e.subtotal, x: e.tax_amount, t: e.total }),
    );
    ok(
      'the rate and label are snapshotted onto the bill',
      e.tax_rate === 17 && e.tax_name === 'GST' && e.tax_inclusive === false,
    );

    // --- tax already inside the price
    await call(`/offices/${office}`, { method: 'PATCH', token, body: { tax_inclusive: true } });
    const incl = await sell({ lines: [{ product_id: product.id, quantity: 1, price: 1000 }] });
    clean.delete(`/sales/${incl.json.data.id}`);
    ok(
      'inclusive: the total stays 1000 and 145.30 of it is tax',
      incl.json.data.total === 1000 && incl.json.data.tax_amount === 145.3,
      JSON.stringify({ t: incl.json.data.total, x: incl.json.data.tax_amount }),
    );

    // --- an old bill keeps its own rate
    await call(`/offices/${office}`, {
      method: 'PATCH',
      token,
      body: { tax_rate: 5, tax_inclusive: false },
    });
    const old = await call(`/sales/${e.id}?office_id=${office}`, { token });
    ok(
      'changing the branch rate never rewrites an old bill',
      old.json.data.tax_rate === 17 && old.json.data.total === 2340,
      JSON.stringify({ r: old.json.data.tax_rate, t: old.json.data.total }),
    );
    ok(
      'the receipt call carries the registration number',
      old.json.data.office_tax_number === `TN-${s}`,
      String(old.json.data.office_tax_number),
    );

    // --- credit sale: the borrow is on the taxed total
    const credit = await sell({
      customer_name: 'Credit Walk-in',
      customer_mobile: '03001112233',
      is_borrow: true,
      paid_amount: 1000,
      lines: [{ product_id: product.id, quantity: 2, price: 1000 }],
    });
    clean.delete(`/sales/${credit.json.data.id}`);
    ok(
      'borrow is the taxed total less what was paid (2100 - 1000)',
      credit.json.data.borrow_amount === 1100,
      String(credit.json.data.borrow_amount),
    );
    ok(
      'a credit sale with no customer and no mobile is refused',
      (await sell({ is_borrow: true, paid_amount: 0, lines: [{ product_id: product.id, quantity: 1, price: 1000 }] }))
        .status === 400,
    );

    // --- oversell: five tills, one unit
    const single = (
      await call('/products', {
        method: 'POST',
        token,
        body: {
          office_id: office,
          name: `E2E Race ${s}`,
          sku: `RACE-${s}`,
          price: 100,
          quantity: 1,
          status: 'active',
        },
      })
    ).json.data;
    clean.delete(`/products/${single.id}`);

    const attempts = await Promise.all(
      Array.from({ length: 5 }, () =>
        sell({ lines: [{ product_id: single.id, quantity: 1, price: 100 }] }),
      ),
    );
    const sold = attempts.filter((a) => a.status === 201);
    sold.forEach((a) => clean.delete(`/sales/${a.json.data.id}`));
    ok('exactly one of five simultaneous sales succeeds', sold.length === 1, `${sold.length} went through`);
    ok('the other four are refused', attempts.filter((a) => a.status === 400).length === 4);
    ok('stock lands on zero, never negative', (await qty(single.id)) === 0);

    // --- a refund puts the stock back
    const refundable = await sell({ lines: [{ product_id: product.id, quantity: 3, price: 1000 }] });
    clean.delete(`/sales/${refundable.json.data.id}`);
    const stockBefore = await qty(product.id);
    await call(`/sales/${refundable.json.data.id}`, {
      method: 'PATCH',
      token,
      body: { status: 'refunded' },
    });
    ok('a refund returns the units', (await qty(product.id)) === round2(stockBefore + 3));

    await clean.run();
  },
};
