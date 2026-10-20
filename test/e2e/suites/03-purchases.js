const { call, uniq, dateIn, cleaner } = require('../harness');

/**
 * Buying: stock comes in, the supplier is owed, the landed cost is remembered
 * and a batch with a date lands in the lot register. Reversing a bill has to
 * undo all of it — unless the stock has already been sold on.
 */
module.exports = {
  name: 'purchases, suppliers & lots',
  async run({ ok, token, office }) {
    const clean = cleaner(call, token);
    const s = uniq();
    const qty = async (id) =>
      (await call(`/products/${id}?office_id=${office}`, { token })).json?.data?.quantity;
    const payable = async (id) =>
      (await call(`/suppliers/${id}?office_id=${office}`, { token })).json?.data?.payable_amount;

    const supplier = (
      await call('/suppliers', {
        method: 'POST',
        token,
        body: {
          office_id: office,
          name: `E2E Supplier ${s}`,
          company: 'E2E & Sons',
          mobile_no: `0300${String(s).slice(-7)}`,
        },
      })
    ).json.data;
    ok('supplier created with a zero balance', supplier?.payable_amount === 0);
    clean.delete(`/suppliers/${supplier.id}`);

    const product = (
      await call('/products', {
        method: 'POST',
        token,
        body: {
          office_id: office,
          name: `E2E Buy ${s}`,
          sku: `BUY-${s}`,
          price: 500,
          quantity: 0,
          status: 'active',
        },
      })
    ).json.data;
    clean.delete(`/products/${product.id}`);

    // --- 20 @ 300 = 6000, paid 2000
    const bill = await call('/purchases', {
      method: 'POST',
      token,
      body: {
        office_id: office,
        supplier_id: supplier.id,
        supplier_invoice_no: `INV-${s}`,
        status: 'received',
        paid_amount: 2000,
        lines: [
          {
            product_id: product.id,
            quantity: 20,
            cost_price: 300,
            batch_no: `B-${s}`,
            expiry_date: dateIn(10),
          },
        ],
      },
    });
    ok('purchase recorded', bill.status === 201, JSON.stringify(bill.json));
    const purchase = bill.json.data;
    ok('a bill number is issued', /^PUR-\d{4}$/.test(purchase?.purchase_no ?? ''), purchase?.purchase_no);
    ok(
      'total 6000, paid 2000, due 4000',
      purchase.total === 6000 && purchase.paid_amount === 2000 && purchase.due_amount === 4000,
      JSON.stringify({ t: purchase.total, p: purchase.paid_amount, d: purchase.due_amount }),
    );
    ok('stock went up to 20', (await qty(product.id)) === 20);
    ok('the supplier is owed 4000', (await payable(supplier.id)) === 4000);
    ok(
      'the landed cost is remembered on the product',
      (await call(`/products/${product.id}?office_id=${office}`, { token })).json.data.cost_price === 300,
    );

    // --- the lot register picked up the batch
    const lots = await call(`/reports/expiry?office_id=${office}&within_days=30&limit=50`, { token });
    const lot = lots.json?.data?.data?.find((r) => r.batch_no === `B-${s}`);
    ok('the batch is in the expiry register', !!lot, JSON.stringify(lots.json?.data?.data)?.slice(0, 200));
    ok(
      'the lot carries units, days left and value at cost',
      lot?.quantity === 20 && lot?.days_left >= 9 && lot?.cost_value === 6000,
      JSON.stringify({ q: lot?.quantity, d: lot?.days_left, v: lot?.cost_value }),
    );

    // --- paying the supplier
    const paid = await call(`/suppliers/${supplier.id}/payments`, {
      method: 'POST',
      token,
      body: { amount: 1500 },
    });
    ok('a supplier payment is accepted', paid.status === 201, JSON.stringify(paid.json));
    ok('the payable drops to 2500', paid.json?.data?.supplier?.payable_amount === 2500);

    const over = await call(`/suppliers/${supplier.id}/payments`, {
      method: 'POST',
      token,
      body: { amount: 99999 },
    });
    ok(
      'paying more than is owed is refused',
      over.status === 400 && !!over.json?.errors?.amount,
      JSON.stringify(over.json),
    );
    ok(
      'deleting a supplier who is still owed is refused',
      (await call(`/suppliers/${supplier.id}`, { method: 'DELETE', token })).status === 409,
    );

    // --- a sale eats into the received stock, so the bill can no longer be undone
    const sale = await call('/sales', {
      method: 'POST',
      token,
      body: {
        office_id: office,
        customer_name: 'Walk-in',
        payment_method: 'cash',
        lines: [{ product_id: product.id, quantity: 15, price: 500 }],
      },
    });
    ok('15 units sold', sale.status === 201, JSON.stringify(sale.json)?.slice(0, 200));

    const blocked = await call(`/purchases/${purchase.id}`, { method: 'DELETE', token });
    ok('reversing the bill is refused once sold on', blocked.status === 400, String(blocked.status));
    ok('stock is untouched by the refusal', (await qty(product.id)) === 5);

    // --- put the sale back and the reversal goes through
    await call(`/sales/${sale.json.data.id}`, { method: 'PATCH', token, body: { status: 'refunded' } });
    const reversed = await call(`/purchases/${purchase.id}`, { method: 'DELETE', token });
    ok('the bill reverses once the stock is back', reversed.status === 200, JSON.stringify(reversed.json));
    ok('stock returns to zero', (await qty(product.id)) === 0);
    ok('the payable is released', (await payable(supplier.id)) === 0);

    const gone = await call(`/reports/expiry?office_id=${office}&within_days=30&limit=50`, { token });
    ok(
      'the reversed bill leaves no lot behind',
      !(gone.json?.data?.data ?? []).some((r) => r.batch_no === `B-${s}`),
    );

    await call(`/sales/${sale.json.data.id}`, { method: 'DELETE', token });
    await clean.run();
  },
};
