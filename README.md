# Codex API

REST API for the Codex multi-branch inventory & POS system — NestJS 11 + MongoDB.

## Requirements

- Node 20+
- MongoDB 6+ running locally (or a connection to a remote server)

## Setup

```bash
npm install
cp .env.example .env     # then edit the values
npm run seed             # creates the head office, Admin role and admin user
npm run start:dev
```

The API listens on `http://localhost:3000/api`.
Interactive docs: **http://localhost:3000/api/docs** (the bare root redirects there).

Seeded login: `admin@codex.com` / `Admin@123456` — change it after the first sign-in.

## Environment

| Key | Meaning |
|---|---|
| `DATABASE_HOST` / `DATABASE_PORT` / `DATABASE_NAME` | MongoDB connection |
| `PORT` | HTTP port (default 3000) |
| `APP_URL` | public URL, used in password-reset links |
| `JWT_SECRET` | signing secret — must be long and random in production |
| `JWT_EXPIRES` | token lifetime, e.g. `1d` |
| `CORS_ORIGIN` | comma-separated list of allowed origins |

`.env` is git-ignored. Never commit real secrets.

## Architecture

```
src/
  common/        guards, decorators, filters, interceptors, storage, counters,
                 audit trail, trash/restore
  config/        env loading + validation
  database/      Mongoose connection
  modules/
    auth         login, logout, password reset, change password
    access       per-role permission matrix
    customers    customer book + borrow repayments
    dashboard    KPIs, trend, payment mix, top products, low stock
    locations    racks and their generated row/column/bin slots
    office       branches, head office, online payment methods
    products     catalogue, stock levels, reorder level, unit + pack size
    profile      the signed-in user
    purchases    supplier bills, stock in, landed cost, batch/expiry lots
    reports      sales, item-wise + margin, stock, receivables, payables,
                 expiry, day close
    roles        office-scoped roles
    sales        point of sale, refunds, stock movement, tax, receipts
    staff        staff accounts
    stock        adjustments (damage, loss, recount) and branch transfers
    suppliers    supplier book + payments against the payable
```

### Conventions

- **Response envelope.** Success is `{ success, message, data }`; errors are
  `{ success: false, statusCode, message, errors? }`, where `errors` maps a
  field to its validation messages.
- **Soft deletes.** Rows carry `deleted_at` and are filtered out of every read;
  nothing is physically removed.
- **Office scoping.** Products, sales, purchases, customers, racks and roles
  belong to one office and cannot be moved to another after creation. Stock
  crosses branches only through a transfer, which is recorded at both ends.
- **Stock has one owner.** `products.quantity` is the only stock figure.
  Sales take from it, purchases add to it, adjustments correct it and
  transfers move it — every one of them with a guarded, conditional update, so
  two tills cannot oversell the same unit.
- **Ledger records are reversed, not restored.** Deleting a sale, purchase or
  transfer puts the stock and the money back; those documents never appear in
  the trash. Catalogue records (products, customers, suppliers, staff,
  offices, racks) do, and can be restored.
- **Validation.** DTOs use `class-validator`; unknown properties are stripped by
  the global pipe, so a client can never set a field the DTO does not declare.

## Security

Four guards run on every request, in order:

1. `JwtAuthGuard` — verifies the bearer token (opt out with `@Public()`).
2. `ThrottlerGuard` — 300 req/min per IP; credential routes are capped at 5/min.
3. `PermissionsGuard` — enforces the role's access matrix server-side via
   `@RequirePermission(module, action)` / `@AdminOnly()`. Fails closed.
4. `OfficeScopeGuard` — rejects an `office_id` the caller is not assigned to.
   A transfer names two offices (`office_id` and `to_office_id`) and both ends
   are checked.

Every successful change is written to the audit trail by `AuditInterceptor`
(`GET /api/audit-logs`, admin only): who, which module, which record, when and
from which IP. Reads are not logged, and no request body is ever stored, so
passwords and uploaded images stay out of it. Entries roll off after 180 days.

Passwords are bcrypt-hashed. Reset tokens are stored as SHA-256 hashes with a
30-minute expiry and are single-use. `helmet` sets the response security headers.

> Hiding a button is not access control. Every endpoint is gated on the server,
> independently of what the UI chooses to render.

## Tests

```bash
npm test             # unit tests
npm run test:cov     # with coverage
```

## Scripts

| Command | What it does |
|---|---|
| `npm run start:dev` | watch mode |
| `npm run build` | compile to `dist/` |
| `npm run start:prod` | run the compiled build |
| `npm run seed` | idempotent seed (office, Admin role, admin user) |
| `npm run lint` | ESLint with `--fix` |
| `npm run backup` | gzipped dump of every collection into `backups/` |
| `npm run restore -- --latest --yes` | put the newest backup back |

## Backups

The database holds everything the shop has entered, so back it up on a
schedule. `npm run backup` needs no MongoDB command-line tools: it reads every
collection and writes one gzipped Extended JSON file, which keeps ObjectIds and
dates exactly as they were.

```bash
npm run backup                              # -> backups/codex-backup-2026-10-08_0300.json.gz
BACKUP_DIR=D:/codex-backups npm run backup  # somewhere off this disk
BACKUP_KEEP=30 npm run backup               # how many to keep (default 14)
```

Restoring:

```bash
npm run restore -- --latest --yes           # merge the newest file back (upsert by _id)
npm run restore -- --latest --drop --yes    # replace: empty each collection first
npm run restore -- ./backups/codex-backup-2026-10-08_0300.json.gz --yes
```

`--yes` is required — a restore writes over live data. Without `--drop` the
documents are upserted, so anything entered since the backup survives.

**Run it nightly.** On Windows, Task Scheduler → Create Task → Daily at 3am,
action `npm` with arguments `run backup`, "Start in" set to this folder. On
Linux, a cron line does the same:

```cron
0 3 * * * cd /srv/codex && /usr/bin/npm run backup >> /var/log/codex-backup.log 2>&1
```

Keep at least one copy on another disk or machine. `mongodump` works too if you
have the tools installed:

```bash
mongodump --db codex --out /backups/$(date +%F)
mongorestore --db codex /backups/2026-10-08/codex
```

Copying the `data` folder of a running MongoDB is **not** a backup — the files
are mid-write and restore as corrupt.
