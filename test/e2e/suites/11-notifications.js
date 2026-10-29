const { call, uniq, cleaner } = require('../harness');

/**
 * The bell.
 *
 * A live event is gone the moment nobody is looking at the screen, so the
 * branch that has to *do* something also gets a notification that waits. The
 * assertions here are about who is told, what the line says, and that reading
 * it is scoped to the branch it was addressed to.
 */
module.exports = {
  name: 'notifications',
  async run({ ok, token, office, offices }) {
    const other = offices.find((o) => o.id !== office);
    if (!other) {
      ok('a second office exists to notify', false, 'seed one to run this suite');
      return;
    }

    const clean = cleaner(call, token);
    const s = uniq();
    const bell = async (officeId, limit = 20) =>
      (await call(`/notifications?office_id=${officeId}&limit=${limit}`, { token }))
        .json?.data;

    // `office` holds the stock, `other` goes short and asks for it
    const held = (
      await call('/products', {
        method: 'POST',
        token,
        body: {
          office_id: office,
          name: `E2E Bell ${s}`,
          sku: `BELL-${s}`,
          price: 500,
          quantity: 30,
          status: 'active',
        },
      })
    ).json.data;
    clean.delete(`/products/${held.id}`);

    const before = await bell(office);
    const unreadBefore = before?.unread ?? 0;

    // --- asking tells the branch that has to answer
    const made = await call('/stock/requests', {
      method: 'POST',
      token,
      body: {
        office_id: other.id,
        source_office_id: office,
        lines: [{ product_id: held.id, quantity: 4 }],
        note: 'bell test',
      },
    });
    ok('the request is accepted', made.status === 201, JSON.stringify(made.json)?.slice(0, 160));
    const request = made.json.data;

    const held1 = await bell(office);
    const created = held1?.data?.find((n) => n.ref_id === request.id);
    ok(
      'the branch that was asked is told',
      !!created && created.type === 'stock-request.created',
      JSON.stringify(held1?.data?.[0])?.slice(0, 200),
    );
    ok(
      'the line names the branch, the request and the units',
      created?.title_key === 'notif.requestCreated' &&
        created?.params?.request_no === request.request_no &&
        created?.params?.office === other.office_name &&
        created?.params?.units === '4',
      JSON.stringify(created?.params),
    );
    ok(
      'it links to the request, on the side that has to answer it',
      created?.link === '/stock/requests' &&
        created?.link_params?.id === request.id &&
        created?.link_params?.side === 'incoming',
      JSON.stringify(created?.link_params),
    );
    ok('it arrives unread', created?.read === false);
    ok(
      'the unread count went up by one',
      held1?.unread === unreadBefore + 1,
      `${unreadBefore} -> ${held1?.unread}`,
    );

    const asked1 = await bell(other.id);
    ok(
      'the branch that asked is not told about its own request',
      !asked1?.data?.some(
        (n) => n.ref_id === request.id && n.type === 'stock-request.created',
      ),
    );

    // --- reading is scoped to the branch the line belongs to
    const wrongBell = await call(`/notifications/${created.id}/read`, {
      method: 'PATCH',
      token,
      body: { office_id: other.id },
    });
    const stillUnread = (await bell(office))?.data?.find((n) => n.id === created.id);
    ok(
      'another branch cannot read it off your bell',
      wrongBell.status === 200 && stillUnread?.read === false,
      `status ${wrongBell.status}`,
    );

    const read = await call(`/notifications/${created.id}/read`, {
      method: 'PATCH',
      token,
      body: { office_id: office },
    });
    ok('the branch it belongs to can read it', read.status === 200);
    const afterRead = await bell(office);
    ok(
      'reading it clears the line and the count',
      afterRead?.data?.find((n) => n.id === created.id)?.read === true &&
        afterRead?.unread === unreadBefore,
      `${afterRead?.unread}`,
    );

    const countOnly = (await call(`/notifications/count?office_id=${office}`, { token }))
      .json?.data;
    ok(
      'the count endpoint agrees with the list',
      countOnly?.unread === afterRead?.unread,
      JSON.stringify(countOnly),
    );

    // --- the answer goes back to the branch that asked
    const approved = await call(
      `/stock/requests/${request.id}/approve?office_id=${office}`,
      { method: 'PATCH', token },
    );
    ok('the request is approved', approved.status === 200, JSON.stringify(approved.json)?.slice(0, 160));

    const asked2 = await bell(other.id);
    const answer = asked2?.data?.find(
      (n) => n.ref_id === request.id && n.type === 'stock-request.approved',
    );
    ok('the branch that asked hears the answer', !!answer, JSON.stringify(asked2?.data?.[0])?.slice(0, 200));
    ok(
      'the answer names the branch that sent the stock',
      answer?.title_key === 'notif.requestApproved' &&
        answer?.params?.office === (offices.find((o) => o.id === office)?.office_name ?? ''),
      JSON.stringify(answer?.params),
    );
    ok(
      'it opens the request on the asking side',
      answer?.link_params?.side === 'outgoing' && answer?.link_params?.id === request.id,
      JSON.stringify(answer?.link_params),
    );
    ok(
      'the branch that approved is not told about its own answer',
      !(await bell(office))?.data?.some(
        (n) => n.ref_id === request.id && n.type === 'stock-request.approved',
      ),
    );

    // --- a decline carries its reason into the notification
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

    await call(`/stock/requests/${second.id}/decline?office_id=${office}`, {
      method: 'PATCH',
      token,
      body: { reason: 'keeping it for the weekend' },
    });

    const asked3 = await bell(other.id);
    const declined = asked3?.data?.find(
      (n) => n.ref_id === second.id && n.type === 'stock-request.declined',
    );
    ok(
      'a decline reaches the asking branch with its reason',
      declined?.title_key === 'notif.requestDeclined' &&
        declined?.params?.reason === 'keeping it for the weekend',
      JSON.stringify(declined?.params),
    );

    // --- clearing the whole bell
    const unreadAsking = asked3?.unread ?? 0;
    ok('the asking branch has unread news', unreadAsking > 0, `${unreadAsking}`);

    const all = await call('/notifications/read-all', {
      method: 'PATCH',
      token,
      body: { office_id: other.id },
    });
    ok('the whole bell can be read at once', all.status === 200 && all.json?.data?.unread === 0);

    const cleared = await bell(other.id);
    ok('nothing is left unread', cleared?.unread === 0, `${cleared?.unread}`);
    ok(
      'the lines are still there, only read',
      cleared?.data?.some((n) => n.ref_id === second.id && n.read === true),
    );

    // the other branch's bell was not touched by that
    const untouched = await bell(office);
    ok(
      'clearing one branch leaves the other alone',
      untouched?.data?.length > 0,
      `${untouched?.data?.length}`,
    );

    await clean.run();
  },
};
