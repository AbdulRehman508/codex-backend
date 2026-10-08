#!/usr/bin/env node
/**
 * Restore a backup written by `npm run backup`.
 *
 *   npm run restore -- --latest --yes          # newest file in ./backups
 *   npm run restore -- ./backups/codex-backup-2026-10-08_0300.json.gz --yes
 *   npm run restore -- --latest --drop --yes   # replace, do not merge
 *
 * Without --drop the documents are upserted by _id, so anything added since
 * the backup survives. With --drop each restored collection is emptied first.
 * --yes is required: this writes over live data.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const { MongoClient } = require('mongodb');
const { EJSON } = require('bson');

const ROOT = path.join(__dirname, '..');

function loadEnv() {
  const file = path.join(ROOT, '.env');
  const env = { ...process.env };
  if (!fs.existsSync(file)) return env;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (env[key] !== undefined) continue;
    env[key] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

function mongoUri(env) {
  const host = env.DATABASE_HOST || 'localhost';
  const port = env.DATABASE_PORT || '27017';
  const name = env.DATABASE_NAME || 'codex';
  const user = env.DATABASE_USER;
  const pass = env.DATABASE_PASSWORD;
  const auth = user
    ? `${encodeURIComponent(user)}:${encodeURIComponent(pass ?? '')}@`
    : '';
  return { uri: `mongodb://${auth}${host}:${port}`, db: name };
}

function newestBackup(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^codex-backup-.*\.json\.gz$/.test(f))
    .map((f) => ({ p: path.join(dir, f), t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return files[0]?.p ?? null;
}

(async () => {
  const env = loadEnv();
  const args = process.argv.slice(2);
  const drop = args.includes('--drop');
  const confirmed = args.includes('--yes');
  const dir = path.resolve(env.BACKUP_DIR || path.join(ROOT, 'backups'));

  let file = args.find((a) => !a.startsWith('--'));
  if (args.includes('--latest') || !file) file = newestBackup(dir);

  if (!file || !fs.existsSync(file)) {
    console.error(
      `No backup file to restore. Pass a path, or --latest to take the newest in ${dir}.`,
    );
    process.exit(1);
  }
  if (!confirmed) {
    console.error(
      `This writes over the live database.\n` +
        `  file : ${file}\n` +
        `  mode : ${drop ? 'DROP each collection, then insert' : 'merge (upsert by _id)'}\n` +
        `Re-run with --yes to go ahead.`,
    );
    process.exit(1);
  }

  const payload = EJSON.parse(
    zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'),
  );
  const { uri, db: dbName } = mongoUri(env);

  console.log(
    `Restoring ${file}\n  taken at : ${payload.meta?.taken_at ?? 'unknown'}\n` +
      `  into     : ${dbName}\n  mode     : ${drop ? 'drop + insert' : 'merge'}\n`,
  );

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  await client.connect();
  const db = client.db(dbName);

  let restored = 0;
  for (const [name, docs] of Object.entries(payload.collections ?? {})) {
    const col = db.collection(name);
    if (drop) {
      await col.deleteMany({});
    }
    if (!docs.length) {
      console.log(`  ${name}: empty`);
      continue;
    }
    // upsert by _id: a merge never duplicates, a drop+insert is still one pass
    const ops = docs.map((doc) => ({
      replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true },
    }));
    const res = await col.bulkWrite(ops, { ordered: false });
    const n = (res.upsertedCount ?? 0) + (res.modifiedCount ?? 0);
    restored += docs.length;
    console.log(`  ${name}: ${docs.length} documents (${n} written)`);
  }

  await client.close();
  console.log(`\nRestore complete — ${restored} documents.`);
})().catch((err) => {
  console.error('Restore failed:', err.message);
  process.exit(1);
});
