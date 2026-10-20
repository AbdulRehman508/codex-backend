#!/usr/bin/env node
/**
 * End-to-end suite runner.
 *
 *   npm run test:e2e                                  # against localhost:3000
 *   API_BASE=http://localhost:3010/api npm run test:e2e
 *   npm run test:e2e -- transfers reports             # only matching suites
 *
 * Signs in once and hands the token to every suite, so the login rate limit
 * is never the thing that fails a run.
 */
const fs = require('fs');
const path = require('path');
const { BASE, call, login, recorder } = require('./harness');

const SUITES_DIR = path.join(__dirname, 'suites');

async function main() {
  const filters = process.argv.slice(2).filter((a) => !a.startsWith('-'));

  const files = fs
    .readdirSync(SUITES_DIR)
    .filter((f) => f.endsWith('.js'))
    .sort();

  const suites = files
    .map((f) => ({ file: f, ...require(path.join(SUITES_DIR, f)) }))
    .filter((s) => !filters.length || filters.some((f) => s.file.includes(f) || s.name.includes(f)));

  console.log(`\nCodex end-to-end suite — ${BASE}\n`);

  const token = await login();
  const offices = (await call('/offices?limit=10', { token })).json?.data?.data ?? [];
  if (!offices.length) {
    console.error('No office found. Run `npm run seed` against this database first.');
    process.exit(1);
  }
  const office = offices[0].id;

  const all = [];
  const startedAt = Date.now();

  for (const suite of suites) {
    const { results, ok } = recorder(suite.name);
    process.stdout.write(`  ${suite.name} ... `);
    const began = Date.now();
    try {
      await suite.run({ ok, token, office, offices });
    } catch (err) {
      ok(`${suite.name} threw`, false, err?.stack ?? String(err));
    }
    const secs = ((Date.now() - began) / 1000).toFixed(1);
    console.log(
      results.fail
        ? `${results.pass} passed, ${results.fail} FAILED (${secs}s)`
        : `${results.pass} passed (${secs}s)`,
    );
    all.push(results);
  }

  const pass = all.reduce((n, r) => n + r.pass, 0);
  const fail = all.reduce((n, r) => n + r.fail, 0);
  const secs = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log(`\n${'-'.repeat(60)}`);
  console.log(`${pass} passed, ${fail} failed, ${all.length} suites, ${secs}s`);

  if (fail) {
    console.log('\nFailures:');
    for (const r of all) {
      for (const f of r.failures) {
        console.log(`  [${r.name}] ${f.label}${f.detail ? ` — ${f.detail}` : ''}`);
      }
    }
  }
  console.log('');

  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error('\nThe run could not start:', err.message);
  console.error('Is the API running, and seeded?\n');
  process.exit(1);
});
