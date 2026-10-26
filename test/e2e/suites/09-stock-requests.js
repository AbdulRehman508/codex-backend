const { call, uniq, cleaner } = require('../harness');

/**
 * Asking another branch for stock.
 *
 * The point of the module is that nothing moves on the asking: a request is a
 * question, the holding branch answers it, and only an approval shifts units.
 * These assertions are mostly about that boundary — who may answer, what a
 * "no" has to carry, and that an answered request cannot be answered twice.
 */
module.exports = {
  name: 'stock requests',
  async run({ ok, token, office, offices }) {
    const other = offices.find((o) => o.id !== office);
    if (!other) {
      ok('a second office exists to ask', false, 'seed one to run this suite');
      return;
    }

    const clean = cleaner(call, token);
    const s = uniq();
    const qty = async (id, inOffice) =>
      (await call(`/products/${id}?office_id=${inOffice}`, { token })).json?.data?.quantity;

    // `office` holds the stock; `other` is short of it and does the asking
    const held = (
      await call('/products', {
        method: 'POST',
        token,
        body: {
          office_id: office,
          name: `E2E Ask ${s}`,
          sku: `ASK-${s}`,
          price: 700,
          quantity: 20,
          status: 'active',
        },
      })
    ).json.data;
    clean.delete(`/products/${held.id}`);

    const empty = (
      await call('/products', {
        method: 'POST',
        token,
        body: {
          office_id: office,
          name: `E2E Ask Empty ${s}`,
          sku: `ASKE-${s}`,
          price: 700,
          quantity: 0,
          status: 'active',
        },
      })
    ).json.data;
    clean.delete(`/products/${empty.id}`);

    // --- the picker
    const picker = (
      await call(
        `/stock/requests/available?source_office_id=${office}&search=${encodeURIComponent(`E2E Ask`)}&limit=50`,
        { token },
      )
    ).json?.data;
    ok(
      'the picker offers what the other branch actually has',
      picker?.some((p) => p.product_id === held.id && p.quantity === 20),
      JSON.stringify(picker)?.slice(0, 200),
    );
    ok(
      'a product with nothing on the shelf is not offered',
      !picker?.some((p) => p.product_id === empty.id),
    );

    // --- asking
    const tooMany = await call('/stock/requests', {
      method: 'POST',
      token,
      body: {
        office_id: other.id,
        source_office_id: office,
        lines: [{ product_id: held.id, quantity: 999 }],
      },
    });
    ok(
      'asking for more than they hold is refused up front',
      tooMany.status === 400,
      JSON.stringify(tooMany.json)?.slice(0, 200),
    );

    const self = await call('/stock/requests', {
      method: 'POST',
      token,
      body: {
        office_id: other.id,
        source_office_id: other.id,
        lines: [{ product_id: held.id, quantity: 1 }],
      },
    });
    ok('a branch cannot ask itself', self.status === 400);

    const made = await call('/stock/requests', {
      method: 'POST',
      token,
      body: {
        office_id: other.id,
        source_office_id: office,
        lines: [{ product_id: held.id, quantity: 5 }],
        note: 'shelf is empty',
      },
    });
    ok('the request is accepted', made.status === 201, JSON.stringify(made.json)?.slice(0, 200));
    const request = made.json.data;
    ok('a request number is issued', /^REQ-\d{4}$/.test(request?.request_no ?? ''), request?.request_no);
    ok('it starts out pending', request?.status === 'pending');
    ok(
      'the lines record what the holding branch had at the time',
      request?.lines?.[0]?.available_at_request === 20,
      JSON.stringify(request?.lines),
    );
    ok('asking moves nothing', (await qty(held.id, office)) === 20);

    // --- who may answer
    const wrongSide = await call(
      `/stock/requests/${request.id}/approve?office_id=${other.id}`,
      { method: 'PATCH', token },
    );
    ok(
      'the branch that asked cannot approve its own request',
      wrongSide.status === 403,
      JSON.stringify(wrongSide.json)?.slice(0, 160),
    );

    const noReason = await call(
      `/stock/requests/${request.id}/decline?office_id=${office}`,
      { method: 'PATCH', token, body: {} },
    );
    ok('a decline without a reason is refused', noReason.status === 400);

    // --- the answer that moves stock
    const approved = await call(
      `/stock/requests/${request.id}/approve?office_id=${office}`,
      { method: 'PATCH', token },
    );
    ok('approving works', approved.status === 200, JSON.stringify(approved.json)?.slice(0, 200));
    ok('the request reads approved', approved.json?.data?.status === 'approved');
    ok('it links the transfer it created', !!approved.json?.data?.transfer_id);
    ok('the holding branch is down 5', (await qty(held.id, office)) === 15);

    const transfer = (
      await call(`/stock/transfers/${approved.json.data.transfer_id}?office_id=${office}`, { token })
    ).json?.data;
    ok(
      'the transfer carries the request number in its note',
      (transfer?.note ?? '').includes(request.request_no),
      transfer?.note,
    );
    const twinId = transfer?.lines?.[0]?.to_product_id;
    ok('the asking branch now has the product', (await qty(twinId, other.id)) === 5);
    clean.delete(`/products/${twinId}`);

    const twice = await call(
      `/stock/requests/${request.id}/approve?office_id=${office}`,
      { method: 'PATCH', token },
    );
    ok('an answered request cannot be answered again', twice.status === 400);

    // --- a "no" carries its reason
    const second = (
      await call('/stock/requests', {
        method: 'POST',
        token,
        body: {
          office_id: other.id,
          source_office_id: office,
          lines: [{ product_id: held.id, quantity: 2 }],
        },
      })
    ).json.data;

    const declined = await call(
      `/stock/requests/${second.id}/decline?office_id=${office}`,
      { method: 'PATCH', token, body: { reason: 'we need these ourselves' } },
    );
    ok('declining works', declined.status === 200, JSON.stringify(declined.json)?.slice(0, 160));
    ok('the reason is kept with the request', declined.json?.data?.decline_reason === 'we need these ourselves');
    ok('a decline moves nothing', (await qty(held.id, office)) === 15);

    // --- taking a request back
    const third = (
      await call('/stock/requests', {
        method: 'POST',
        token,
        body: {
          office_id: other.id,
          source_office_id: office,
          lines: [{ product_id: held.id, quantity: 1 }],
        },
      })
    ).json.data;
    const cancelled = await call(
      `/stock/requests/${third.id}/cancel?office_id=${other.id}`,
      { method: 'PATCH', token },
    );
    ok('the asking branch can take it back while it waits', cancelled.json?.data?.status === 'cancelled');

    // --- the lists each side reads
    const incoming = (
      await call(`/stock/requests?office_id=${office}&direction=incoming&limit=50`, { token })
    ).json?.data;
    ok(
      'the holding branch sees it as incoming',
      incoming?.data?.some((r) => r.id === request.id),
    );
    const outgoing = (
      await call(`/stock/requests?office_id=${other.id}&direction=outgoing&limit=50`, { token })
    ).json?.data;
    ok(
      'the asking branch sees it as outgoing',
      outgoing?.data?.some((r) => r.id === request.id),
    );
    ok(
      'the summary counts what is still waiting on each side',
      typeof incoming?.summary?.pending_incoming === 'number' &&
        typeof outgoing?.summary?.pending_outgoing === 'number',
      JSON.stringify({ i: incoming?.summary, o: outgoing?.summary }),
    );
    ok(
      'search finds a request by its number',
      (
        await call(
          `/stock/requests?office_id=${office}&search=${encodeURIComponent(request.request_no)}`,
          { token },
        )
      ).json?.data?.data?.some((r) => r.id === request.id),
    );

    await clean.run();
  },
};
