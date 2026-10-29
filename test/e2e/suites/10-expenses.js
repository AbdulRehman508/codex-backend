const { call, uniq, cleaner, round2 } = require('../harness');

/**
 * What the shop spends that is not stock.
 *
 * The assertions that matter are not the CRUD ones — they are the two places
 * an expense changes a number the owner acts on: the cash the drawer should
 * hold at close, and the profit after the shop's own bills.
 */
module.exports = {
  name: 'expenses',
  async run({ ok, token, office }) {
    const clean = cleaner(call, token);
    const s = uniq();
    const tz = 'Asia/Karachi';
    const today = new Date().toISOString();

    const dayBefore = (
      await call(`/reports/day-close?office_id=${office}&tz=${encodeURIComponent(tz)}`, { token })
    ).json.data;
    const profitBefore = (
      await call(`/reports/profit?office_id=${office}&period=today&tz=${encodeURIComponent(tz)}`, { token })
    ).json.data;

    // --- recording
    const rentBody = {
      office_id: office,
      category: `E2E Rent ${s}`,
      amount: 5000,
      payment_method: 'cash',
      spent_at: today,
      paid_to: 'Landlord',
      note: 'monthly rent',
    };
    const made = await call('/expenses', { method: 'POST', token, body: rentBody });
    ok('an expense is recorded', made.status === 201, JSON.stringify(made.json)?.slice(0, 200));
    const rent = made.json.data;
    clean.delete(`/expenses/${rent.id}`);
    ok('it is numbered per office', /^EXP-\d{4}$/.test(rent?.expense_no ?? ''), rent?.expense_no);
    ok('cash is the default way money leaves', rent?.payment_method === 'cash');

    const online = (
      await call('/expenses', {
        method: 'POST',
        token,
        body: {
          office_id: office,
          category: `E2E Utilities ${s}`,
          amount: 2000,
          payment_method: 'online',
          spent_at: today,
        },
      })
    ).json.data;
    clean.delete(`/expenses/${online.id}`);

    // --- the list and its totals
    const list = (
      await call(`/expenses?office_id=${office}&search=${encodeURIComponent(`E2E`)}&limit=50`, { token })
    ).json?.data;
    ok(
      'the list totals what was spent, and splits cash from online',
      list?.summary?.total >= 7000 && list?.summary?.cash >= 5000 && list?.summary?.online >= 2000,
      JSON.stringify(list?.summary),
    );
    ok(
      'it breaks the spend down by category',
      list?.summary?.by_category?.some((c) => c.category === `E2E Rent ${s}` && c.amount === 5000),
      JSON.stringify(list?.summary?.by_category)?.slice(0, 200),
    );

    const categories = (await call(`/expenses/categories?office_id=${office}`, { token })).json?.data;
    ok(
      'the picker offers the starter list plus what this branch has used',
      categories?.includes('Rent') && categories?.includes(`E2E Rent ${s}`),
      JSON.stringify(categories)?.slice(0, 200),
    );

    // --- the drawer
    const day = (
      await call(`/reports/day-close?office_id=${office}&tz=${encodeURIComponent(tz)}`, { token })
    ).json.data;
    ok(
      'the day sheet carries the spend',
      day?.expenses?.total === round2(dayBefore.expenses.total + 7000),
      JSON.stringify({ before: dayBefore.expenses, after: day?.expenses }),
    );
    ok(
      'only the cash part leaves the till',
      day?.expenses?.cash === round2(dayBefore.expenses.cash + 5000) &&
        day?.expenses?.online === round2(dayBefore.expenses.online + 2000),
      JSON.stringify(day?.expenses),
    );
    ok(
      'cash out rises by the cash expense, not by the online one',
      day?.cash_drawer?.out === round2(dayBefore.cash_drawer.out + 5000),
      JSON.stringify({ before: dayBefore.cash_drawer, after: day?.cash_drawer }),
    );
    ok(
      'the expected drawer drops by the same 5000',
      day?.cash_drawer?.expected === round2(dayBefore.cash_drawer.expected - 5000),
      JSON.stringify({ before: dayBefore.cash_drawer, after: day?.cash_drawer }),
    );
    ok(
      'the drawer counts up from the float the till opened with',
      day?.cash_drawer?.expected ===
        round2(day.cash_drawer.opening + day.cash_drawer.in - day.cash_drawer.out),
      JSON.stringify(day?.cash_drawer),
    );

    // the float itself, set on the office
    const floatBefore = (await call(`/offices/${office}`, { token })).json?.data?.cash_float ?? 0;
    await call(`/offices/${office}`, { method: 'PATCH', token, body: { cash_float: 3000 } });
    const withFloat = (
      await call(`/reports/day-close?office_id=${office}&tz=${encodeURIComponent(tz)}`, { token })
    ).json.data;
    ok(
      'raising the float raises the expected cash by the same amount',
      withFloat?.cash_drawer?.opening === 3000 &&
        withFloat?.cash_drawer?.expected === round2(day.cash_drawer.expected - day.cash_drawer.opening + 3000),
      JSON.stringify({ before: day?.cash_drawer, after: withFloat?.cash_drawer }),
    );
    clean.after(() =>
      call(`/offices/${office}`, { method: 'PATCH', token, body: { cash_float: floatBefore } }),
    );

    // --- profit after the shop's own bills
    const profit = (
      await call(`/reports/profit?office_id=${office}&period=today&tz=${encodeURIComponent(tz)}`, { token })
    ).json.data;
    ok(
      'profit reports what was spent in the period',
      profit?.totals?.expenses === round2(profitBefore.totals.expenses + 7000),
      JSON.stringify({ before: profitBefore.totals, after: profit?.totals }),
    );
    ok(
      'net profit is the gross less those expenses',
      profit?.totals?.net_profit === round2(profit.totals.profit - profit.totals.expenses),
      JSON.stringify(profit?.totals),
    );
    ok(
      'gross profit is untouched by an expense',
      profit?.totals?.profit === profitBefore.totals.profit,
      JSON.stringify({ before: profitBefore.totals.profit, after: profit?.totals?.profit }),
    );
    ok(
      'the breakdown says where the money went',
      profit?.expense_breakdown?.some((c) => c.category === `E2E Rent ${s}` && c.amount === 5000),
      JSON.stringify(profit?.expense_breakdown)?.slice(0, 200),
    );

    // --- the dashboard an owner opens first
    const board = (await call(`/dashboard?office_id=${office}&period=today`, { token })).json?.data;
    ok(
      'the dashboard carries both the spend and what is left after it',
      typeof board?.kpis?.expenses?.value === 'number' &&
        board?.kpis?.net_profit?.value ===
          round2(board.kpis.profit.value - board.kpis.expenses.value),
      JSON.stringify(board?.kpis),
    );

    // --- fixing and removing
    const fixed = await call(`/expenses/${rent.id}`, {
      method: 'PATCH',
      token,
      body: { amount: 5500, note: 'rent went up' },
    });
    ok('an amount can be corrected', fixed.json?.data?.amount === 5500, JSON.stringify(fixed.json)?.slice(0, 160));

    const removed = await call(`/expenses/${online.id}`, { method: 'DELETE', token });
    ok('an expense can be removed', removed.status === 200);
    ok(
      'and it lands in the trash rather than vanishing',
      (await call(`/trash?module=expenses&office_id=${office}&limit=50`, { token })).json?.data?.data?.some(
        (r) => r.id === online.id,
      ),
    );
    ok(
      'a removed expense is out of the totals',
      (await call(`/expenses?office_id=${office}&search=${encodeURIComponent(`E2E Utilities ${s}`)}`, { token }))
        .json?.data?.total === 0,
    );

    // --- the report sheet an accountant gets
    const sheet = (
      await call(
        `/reports/expenses?office_id=${office}&search=${encodeURIComponent('E2E Rent ' + s)}&limit=20`,
        { token },
      )
    ).json?.data;
    ok(
      'the expenses report lists the same spend',
      sheet?.data?.some((r) => r.category === `E2E Rent ${s}` && r.amount === 5500),
      JSON.stringify(sheet?.data)?.slice(0, 200),
    );
    ok(
      'and totals it, split by how it was paid',
      sheet?.summary?.total === 5500 && sheet?.summary?.cash === 5500 && sheet?.summary?.online === 0,
      JSON.stringify(sheet?.summary),
    );
    ok(
      'the heaviest category is named for the tile',
      sheet?.summary?.top_category === `E2E Rent ${s}`,
      JSON.stringify(sheet?.summary),
    );

    // --- the photographed bill
    const dot =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const withPhoto = (
      await call('/expenses', {
        method: 'POST',
        token,
        body: {
          office_id: office,
          category: `E2E Photo ${s}`,
          amount: 300,
          payment_method: 'cash',
          spent_at: today,
          receipt: dot,
        },
      })
    ).json.data;
    clean.delete(`/expenses/${withPhoto.id}`);
    ok(
      'a receipt photo is stored and comes back as a path, not the data URL',
      !!withPhoto?.receipt && !withPhoto.receipt.startsWith('data:'),
      withPhoto?.receipt,
    );
    const cleared = await call(`/expenses/${withPhoto.id}`, {
      method: 'PATCH',
      token,
      body: { receipt: '' },
    });
    ok('and it can be taken off again', cleared.json?.data?.receipt === null);

    // --- bills that come round again
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const standing = await call('/expenses/recurring', {
      method: 'POST',
      token,
      body: {
        office_id: office,
        category: `E2E Standing ${s}`,
        amount: 1200,
        payment_method: 'cash',
        paid_to: 'Landlord',
        frequency: 'monthly',
        day: 1,
        // dated yesterday on purpose: the sweep should write it at once
        start_from: yesterday,
      },
    });
    ok('a standing instruction is accepted', standing.status === 201, JSON.stringify(standing.json)?.slice(0, 200));
    const rule = standing.json.data;
    clean.delete(`/expenses/recurring/${rule.id}`);

    const listed = (
      await call(`/expenses?office_id=${office}&search=${encodeURIComponent('E2E Standing ' + s)}&limit=10`, { token })
    ).json?.data;
    ok(
      'reading the list writes the bill that had fallen due',
      listed?.total === 1 && listed?.data?.[0]?.amount === 1200,
      JSON.stringify(listed?.data)?.slice(0, 200),
    );
    ok(
      'the written bill carries the date it was due, not today',
      listed?.data?.[0]?.spent_at?.slice(0, 10) === yesterday.slice(0, 10),
      JSON.stringify({ due: yesterday, written: listed?.data?.[0]?.spent_at }),
    );

    const again = (
      await call(`/expenses?office_id=${office}&search=${encodeURIComponent('E2E Standing ' + s)}&limit=10`, { token })
    ).json?.data;
    ok(
      'reading it twice does not write it twice',
      again?.total === 1,
      JSON.stringify({ first: listed?.total, second: again?.total }),
    );

    const rules = (await call(`/expenses/recurring?office_id=${office}`, { token })).json?.data;
    const mine = rules?.find((r) => r.id === rule.id);
    ok(
      'the instruction moves on to its next date',
      !!mine && new Date(mine.next_run) > new Date(),
      JSON.stringify(mine),
    );
    ok('and remembers when it last charged', !!mine?.last_run);

    const paused = await call(`/expenses/recurring/${rule.id}`, {
      method: 'PATCH',
      token,
      body: { active: false },
    });
    ok('it can be paused rather than deleted', paused.json?.data?.active === false);

    const badDay = await call('/expenses/recurring', {
      method: 'POST',
      token,
      body: {
        office_id: office,
        category: `E2E Bad ${s}`,
        amount: 10,
        frequency: 'weekly',
        day: 9,
      },
    });
    ok('a weekly bill cannot ask for day 9', badDay.status === 400);

    // the written bill is cleaned up with everything else
    const written = listed?.data?.[0];
    if (written) clean.delete(`/expenses/${written.id}`);

    await clean.run();
  },
};
