const { call, uniq, cleaner } = require('../harness');

/**
 * Moving stock between branches. Products are office-scoped, so the receiving
 * branch gets its own record for the SKU — created from the sending one the
 * first time it sees it.
 */
module.exports = {
  name: 'branch transfers',
  async run({ ok, token, office, offices }) {
    const other = offices.find((o) => o.id !== office);
    if (!other) {
      ok('a second office exists to transfer to', false, 'seed one to run this suite');
      return;
    }

    const clean = cleaner(call, token);
    const s = uniq();
    const qty = async (id, inOffice) =>
      (await call(`/products/${id}?office_id=${inOffice}`, { token })).json?.data?.quantity;

    const source = (
      await call('/products', {
        method: 'POST',
        token,
        body: {
          office_id: office,
          name: `E2E Move ${s}`,
          sku: `MOVE-${s}`,
          price: 900,
          quantity: 30,
          min_stock: 8,
          unit: 'carton',
          pack_size: 12,
          status: 'active',
        },
      })
    ).json.data;
    clean.delete(`/products/${source.id}`);

    const sent = await call('/stock/transfers', {
      method: 'POST',
      token,
      body: {
        office_id: office,
        to_office_id: other.id,
        lines: [{ product_id: source.id, quantity: 10 }],
        note: 'branch top-up',
      },
    });
    ok('transfer accepted', sent.status === 201, JSON.stringify(sent.json)?.slice(0, 200));
    const transfer = sent.json.data;
    ok('a transfer number is issued', /^TRF-\d{4}$/.test(transfer?.transfer_no ?? ''), transfer?.transfer_no);
    ok('the sending branch is down to 20', (await qty(source.id, office)) === 20);

    const twinId = transfer?.lines?.[0]?.to_product_id;
    ok('the receiving branch got its own product record', !!twinId && twinId !== source.id);
    clean.delete(`/products/${twinId}`);

    const twin = (await call(`/products/${twinId}?office_id=${other.id}`, { token })).json.data;
    ok('the twin holds the ten units', twin?.quantity === 10, String(twin?.quantity));
    ok(
      'the twin copied sku, price, unit, pack size and reorder level',
      twin?.sku === `MOVE-${s}` &&
        twin?.price === 900 &&
        twin?.unit === 'carton' &&
        twin?.pack_size === 12 &&
        twin?.min_stock === 8,
      JSON.stringify(twin),
    );
    ok('the twin belongs to the receiving office', twin?.office_id === other.id);
    ok('the twin has no bin of its own', twin?.rack_location_id === null);

    // --- a second transfer reuses the twin
    const again = await call('/stock/transfers', {
      method: 'POST',
      token,
      body: { office_id: office, to_office_id: other.id, lines: [{ product_id: source.id, quantity: 5 }] },
    });
    ok('a second transfer reuses the same far-end product', again.json?.data?.lines?.[0]?.to_product_id === twinId);
    ok('the twin now holds 15', (await qty(twinId, other.id)) === 15);

    // --- guards
    ok(
      'sending more than is held is refused',
      (await call('/stock/transfers', {
        method: 'POST',
        token,
        body: { office_id: office, to_office_id: other.id, lines: [{ product_id: source.id, quantity: 999 }] },
      })).status === 400,
    );
    ok('stock is untouched after the refusal', (await qty(source.id, office)) === 15);
    ok(
      'a transfer to the same office is refused',
      (await call('/stock/transfers', {
        method: 'POST',
        token,
        body: { office_id: office, to_office_id: office, lines: [{ product_id: source.id, quantity: 1 }] },
      })).status === 400,
    );
    ok(
      'the same product twice on one transfer is refused',
      (await call('/stock/transfers', {
        method: 'POST',
        token,
        body: {
          office_id: office,
          to_office_id: other.id,
          lines: [
            { product_id: source.id, quantity: 1 },
            { product_id: source.id, quantity: 2 },
          ],
        },
      })).status === 400,
    );

    // --- both ends see it, and direction filters work
    ok(
      'the receiver sees it as incoming',
      (await call(`/stock/transfers?office_id=${other.id}&direction=in&limit=20`, { token })).json?.data?.data?.some(
        (r) => r.id === transfer.id,
      ),
    );
    ok(
      'the receiver has nothing outgoing for it',
      !(await call(`/stock/transfers?office_id=${other.id}&direction=out&limit=20`, { token })).json?.data?.data?.some(
        (r) => r.id === transfer.id,
      ),
    );

    // --- reversal is refused once the far branch has sold it on
    const sale = await call('/sales', {
      method: 'POST',
      token,
      body: {
        office_id: other.id,
        customer_name: 'Walk-in',
        payment_method: 'cash',
        lines: [{ product_id: twinId, quantity: 14, price: 900 }],
      },
    });
    ok('the receiving branch sells 14 of its 15', sale.status === 201, JSON.stringify(sale.json)?.slice(0, 160));
    const blocked = await call(`/stock/transfers/${transfer.id}`, { method: 'DELETE', token });
    ok('reversing ten units is refused with only one left there', blocked.status === 400, String(blocked.status));
    ok(
      'nothing moved on the failed reversal',
      (await qty(twinId, other.id)) === 1 && (await qty(source.id, office)) === 15,
    );

    await call(`/sales/${sale.json.data.id}`, { method: 'PATCH', token, body: { status: 'refunded' } });
    const reversed = await call(`/stock/transfers/${transfer.id}`, { method: 'DELETE', token });
    ok('it reverses once the stock is back', reversed.status === 200, JSON.stringify(reversed.json));
    ok('the units returned to the sender', (await qty(source.id, office)) === 25);
    ok('and left the receiver', (await qty(twinId, other.id)) === 5);

    await call(`/sales/${sale.json.data.id}`, { method: 'DELETE', token });
    await call(`/stock/transfers/${again.json.data.id}`, { method: 'DELETE', token });
    await clean.run();
  },
};
