# Deploying Codex

Two routes. Pick one.

- **A — Docker.** One command, everything in containers, MongoDB already set
  up as a replica set. Best for a VPS or any machine where Docker is allowed.
- **B — pm2 + nginx.** No Docker. Best for the shop's own Windows PC, which is
  where most single-branch installs end up.

Either way the browser talks to **one origin**: nginx serves the Angular app
and passes `/api` through to the API. Same origin means the session cookie
works with no CORS exception, and the frontend needs no absolute API URL.

---

## A — Docker

Put the two repositories side by side:

```
/srv/codex/
  codex-backend/codex/     <- deploy/ lives here
  codex-frontend/
```

```bash
cd /srv/codex/codex-backend/codex/deploy
cp .env.example .env
# set JWT_SECRET (long and random), APP_URL, FRONTEND_URL, CORS_ORIGIN
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

docker compose up -d --build
docker compose exec api node dist/seed.js     # first install only
```

The shop is on `http://<server>` (port from `HTTP_PORT`). The API docs are at
`/api/docs`.

Everyday commands:

```bash
docker compose logs -f api
docker compose exec api npm run backup
docker compose pull && docker compose up -d --build   # update
```

> These files have not been run on this machine — Docker is not installed
> here. They follow the standard multi-stage pattern, but expect to fix a path
> or two on the first real deploy.

---

## B — pm2 + nginx (no Docker)

### 1. MongoDB as a replica set

> Already done on this machine (13 Oct 2026): rs0, single member, PRIMARY.
> `scripts/enable-replica-set.ps1` does the whole thing on a new install —
> run it from an elevated PowerShell.

Do this **before** going live. A standalone `mongod` has no transactions and no
oplog, so there is no way to recover to a point in time — which is exactly what
a corrupted database needs.

**Back up first:** `npm run backup`

**Windows** — edit `C:\Program Files\MongoDB\Server\7.0\bin\mongod.cfg`:

```yaml
replication:
  replSetName: rs0
```

```powershell
Restart-Service MongoDB
mongosh --eval "rs.initiate({_id:'rs0', members:[{_id:0, host:'localhost:27017'}]})"
mongosh --eval "rs.status().ok"      # 1 means it took
```

**Linux** — the same block in `/etc/mongod.conf`, then
`sudo systemctl restart mongod` and the same two `mongosh` lines.

Nothing in the app changes: the existing data stays where it is, and the
connection string still works.

### 2. The API

```bash
cd codex-backend/codex
npm ci
cp .env.example .env         # fill in JWT_SECRET, DATABASE_*, APP_URL
npm run build
npm run seed                 # first install only

npm i -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup                  # run the line it prints, so it survives a reboot
```

### 3. The frontend

```bash
cd codex-frontend
npm ci --legacy-peer-deps
npx ng build                 # output: dist/code-link-sw/browser
```

Serve that folder with nginx and proxy `/api` to `http://127.0.0.1:3000`.
`codex-frontend/deploy/nginx.conf` is the config — change `proxy_pass
http://api:3000` to `http://127.0.0.1:3000` outside Docker.

On Windows, IIS works too: serve the `browser` folder as a site, add URL
Rewrite rules for `/api` → `http://localhost:3000/api` and a fallback rule
sending everything else to `index.html`.

---

## HTTPS

Without it, the session cookie travels in the clear on the shop's wifi. With a
domain name:

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d shop.example.com
```

Certbot edits the nginx config and renews on its own. Then set `APP_URL`,
`FRONTEND_URL` and `CORS_ORIGIN` to the `https://` address and restart the API.

On a LAN-only install with no domain, use the machine's own certificate or
accept that the install is trusted-network-only — and say so to the shop.

---

## Backups

The nightly job is already registered on this machine as the Windows task
**"Codex DB Backup"** (3:00 am, runs `scripts/backup.bat`). Check it with:

```powershell
schtasks /Query /TN "Codex DB Backup" /FO LIST
Get-Content "E:\Project\codex-backend\codex\backups\backup.log" -Tail 20
```

On a server, cron does the same:

```cron
0 3 * * * cd /srv/codex/codex-backend/codex && /usr/bin/npm run backup >> backups/backup.log 2>&1
```

**A backup on the same disk is not a backup.** Copy the `backups` folder to a
second disk, a USB drive or cloud storage. Restore steps are in the README.

---

## Go-live checklist

- [ ] `JWT_SECRET` is long, random, and not the one from any example file
- [ ] The seeded `admin@codex.com` password has been changed
- [ ] MongoDB is a replica set (`rs.status().ok === 1`)
- [ ] MongoDB does **not** listen on a public interface, or needs a password
- [ ] `CORS_ORIGIN` names the real address, not `*`
- [ ] HTTPS is on, or the install is on a trusted LAN only
- [ ] A backup has been taken **and restored once into a scratch database**, so
      you know the file actually works
- [ ] Backups are copied off the machine
- [ ] The nightly backup job is registered and its log shows a recent success
- [ ] Each staff member has their own account — no shared logins, or the audit
      trail says nothing useful
- [ ] Roles grant only what each job needs; the Admin role is for the owner
