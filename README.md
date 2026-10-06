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
  common/        guards, decorators, filters, interceptors, storage, counters
  config/        env loading + validation
  database/      Mongoose connection
  modules/
    auth         login, logout, password reset, change password
    access       per-role permission matrix
    customers    customer book + borrow repayments
    dashboard    KPIs, trend, payment mix, top products, low stock
    locations    racks and their generated row/column/bin slots
    office       branches, head office, online payment methods
    products     catalogue and stock levels
    profile      the signed-in user
    reports      sales, item-wise, stock, receivables
    roles        office-scoped roles
    sales        point of sale, refunds, stock movement, receipts
    staff        staff accounts
```

### Conventions

- **Response envelope.** Success is `{ success, message, data }`; errors are
  `{ success: false, statusCode, message, errors? }`, where `errors` maps a
  field to its validation messages.
- **Soft deletes.** Rows carry `deleted_at` and are filtered out of every read;
  nothing is physically removed.
- **Office scoping.** Products, sales, customers, racks and roles belong to one
  office, and cannot be moved to another after creation.
- **Validation.** DTOs use `class-validator`; unknown properties are stripped by
  the global pipe, so a client can never set a field the DTO does not declare.

## Security

Four guards run on every request, in order:

1. `JwtAuthGuard` — verifies the bearer token (opt out with `@Public()`).
2. `ThrottlerGuard` — 300 req/min per IP; credential routes are capped at 5/min.
3. `PermissionsGuard` — enforces the role's access matrix server-side via
   `@RequirePermission(module, action)` / `@AdminOnly()`. Fails closed.
4. `OfficeScopeGuard` — rejects an `office_id` the caller is not assigned to.

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

## Backups

The database holds everything the shop has entered. Take a dump regularly:

```bash
mongodump --db codex --out /backups/$(date +%F)
mongorestore --db codex /backups/2026-10-06/codex
```

Copying the `data` folder of a running MongoDB is **not** a backup — the files
are mid-write and restore as corrupt.
