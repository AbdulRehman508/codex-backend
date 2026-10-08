#!/usr/bin/env node
/**
 * Database backup — one gzipped file per run, no external tools needed.
 *
 *   npm run backup                 # into ./backups, keeping the last 14
 *   BACKUP_DIR=D:/codex-backups npm run backup
 *   BACKUP_KEEP=30 npm run backup
 *
 * Every collection is written as Extended JSON, so ObjectIds and Dates come
 * back exactly as they went in. Restore with `npm run restore`.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const { MongoClient } = require('mongodb');
const { EJSON } = require('bson');

const ROOT = path.join(__dirname, '..');

/** Minimal .env reader — the app's own config is NestJS-side. */
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
    // the shell wins: a value exported outside overrides the file
    if (env[key] !== undefined) continue;
    env[key] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

function mongoUri(env) {
  if (env.DATABASE_URI) return env.DATABASE_URI;
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

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Delete the oldest files once more than `keep` remain. */
function rotate(dir, keep) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^codex-backup-.*\.json\.gz$/.test(f))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  const dropped = files.slice(keep);
  for (const { f } of dropped) fs.unlinkSync(path.join(dir, f));
  return dropped.length;
}

(async () => {
  const env = loadEnv();
  const { uri, db: dbName } = mongoUri(env);
  const dir = path.resolve(env.BACKUP_DIR || path.join(ROOT, 'backups'));
  const keep = Math.max(1, parseInt(env.BACKUP_KEEP || '14', 10));

  fs.mkdirSync(dir, { recursive: true });

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  await client.connect();
  const db = client.db(dbName);

  const names = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .filter((n) => !n.startsWith('system.'))
    .sort();

  const payload = {
    meta: {
      database: dbName,
      taken_at: new Date().toISOString(),
      collections: names.length,
      tool: 'codex backup v1',
    },
    collections: {},
  };

  let docCount = 0;
  for (const name of names) {
    const docs = await db.collection(name).find({}).toArray();
    payload.collections[name] = docs;
    docCount += docs.length;
    console.log(`  ${name}: ${docs.length} documents`);
  }
  await client.close();

  const file = path.join(dir, `codex-backup-${stamp()}.json.gz`);
  // relaxed:false keeps the exact BSON types on the way back in
  const body = EJSON.stringify(payload, { relaxed: false });
  fs.writeFileSync(file, zlib.gzipSync(Buffer.from(body, 'utf8')));

  const removed = rotate(dir, keep);
  console.log(
    `\nBackup written: ${file} (${humanSize(fs.statSync(file).size)})\n` +
      `${docCount} documents from ${names.length} collections` +
      (removed ? `, ${removed} old backup(s) removed` : ''),
  );
})().catch((err) => {
  console.error('Backup failed:', err.message);
  process.exit(1);
});
