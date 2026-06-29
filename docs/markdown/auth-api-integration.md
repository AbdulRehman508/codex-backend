# Authentication API — Frontend Integration Guide

Hand this to the frontend team. Auth users = the **staff** table (login with staff email + password).

---

## 0. Basics

- **Base URL:** `http://localhost:3000/api`
- **Auth scheme:** JWT Bearer.
  1. Login → receive `token`.
  2. Store token in `localStorage`.
  3. Send `Authorization: Bearer <token>` on **every protected** request.
- **Auto-logout:** any protected endpoint returning `401` → clear token + redirect to `/login`.

### Success envelope (every 2xx)
```json
{ "success": true, "message": "string", "data": <payload> }
```

### Error envelope (every 4xx/5xx)
```json
{ "success": false, "statusCode": 401, "message": "string", "errors": { "field": ["msg"] } }
```
`errors` present only on `400` validation failures.

### The `user` object (returned by login and `/me`)
```json
{
  "id": "665f...",
  "first_name": "Ali",
  "last_name": "Khan",
  "email": "ali@example.com",
  "role_id": 1,
  "role": "Admin",
  "office_id": "665a...",
  "profile_photo": "http://localhost:3000/uploads/staff/uuid.png",
  "staff_status": "active"
}
```
`profile_photo` may be `null`. `password` is never returned.

---

## 1. Endpoints

### 1.1 Login — `POST /api/auth/login` (public)

Request:
```json
{ "email": "ali@example.com", "password": "StrongPass@123", "remember_me": true }
```
- `remember_me` optional (default `false`). `true` → 30-day token; `false` → 1-day token.

Success → `200`:
```json
{
  "success": true,
  "message": "Logged in",
  "data": {
    "token": "<jwt>",
    "token_type": "Bearer",
    "expires_in": 2592000,
    "user": { /* user object, see §0 */ }
  }
}
```
- `expires_in` is in **seconds** — use it to pre-empt expiry / schedule re-login.

Errors:
- `401` → `{ "message": "Invalid email or password" }` (same for wrong email or wrong password — don't show which).
- `403` → `{ "message": "Account is inactive" }` (staff_status = inactive).
- `400` → validation (missing/invalid email or password).

### 1.2 Current user — `GET /api/auth/me` (protected)
Re-hydrate session on page refresh.
Success → `200`, `data` = the **user object** (no token).
`401` if token invalid/expired → log out.

### 1.3 Logout — `POST /api/auth/logout` (protected)
Stateless — server just acknowledges; the frontend must drop the token.
Success → `200`:
```json
{ "success": true, "message": "Logged out", "data": { "success": true } }
```

### 1.4 Forgot password — `POST /api/auth/forgot-password` (public)
Request:
```json
{ "email": "ali@example.com" }
```
Always returns `200` (does **not** reveal whether the email exists):
```json
{ "success": true, "message": "If the email exists, a reset link has been sent", "data": { "sent": true } }
```
Server emails a link: `<FRONTEND_URL>/reset-password?token=<resetToken>` (token valid 30 min, single-use).
> Dev note: mail is currently **console-logged** by the backend (no SMTP yet). Grab the link from the server console while testing.

### 1.5 Reset password — `POST /api/auth/reset-password` (public)
Read `token` from the URL query (`/reset-password?token=...`).
Request:
```json
{ "token": "<resetToken>", "password": "NewStrongPass@123" }
```
Success → `200`:
```json
{ "success": true, "message": "Password updated", "data": { "success": true } }
```
Errors:
- `400` → `{ "message": "Reset token is invalid or expired" }`.
- `400` → password policy failure → `errors.password` array.

### 1.6 Change password — `POST /api/auth/change-password` (protected)
Request:
```json
{ "current_password": "OldPass@123", "new_password": "NewStrongPass@123" }
```
Success → `200`:
```json
{ "success": true, "message": "Password updated", "data": { "success": true } }
```
Errors:
- `400` → `{ "message": "Current password is incorrect" }`.
- `400` → policy failure → `errors.new_password` array.

> No `/refresh` endpoint — single access token only. When it expires, user logs in again.

---

## 2. Validation rules (mirror on frontend for UX; server enforces)

| field | rule |
|-------|------|
| `email` | required, valid email |
| `password` (login) | required |
| `remember_me` | boolean, default `false` |
| `token` (reset) | required |
| `password` (reset) / `new_password` (change) | min 12 chars, ≥1 uppercase, ≥1 digit, ≥1 special `!@#$%^&*(),.?":{}|<>` |
| `current_password` (change) | required |

Validation failure → `400`, e.g.:
```json
{
  "success": false,
  "statusCode": 400,
  "message": "Validation failed",
  "errors": { "new_password": ["password must be at least 12 characters", "password must contain at least one digit"] }
}
```

---

## 3. Field-name contract (do NOT rename)
- **Request:** `email, password, remember_me, token, current_password, new_password`.
- **Response:** `token, token_type, expires_in, user{ id, first_name, last_name, email, role_id, role, office_id, profile_photo, staff_status }`.

---

## 4. Suggested frontend flow

**HTTP layer**
1. Request interceptor: attach `Authorization: Bearer <token>` from `localStorage` (skip for `/auth/login`, `/auth/forgot-password`, `/auth/reset-password`).
2. Response interceptor: on `401` → clear token + redirect `/login`.
3. Read payloads as `res.data.data`.

**Login screen**
- POST `/auth/login` → save `data.token`, save `data.user`, redirect to dashboard.
- Map `403` → "Account is inactive"; `401` → "Invalid email or password".

**App bootstrap / refresh**
- If token in storage → GET `/auth/me` → set current user. On `401` → log out.

**Logout**
- POST `/auth/logout` (best-effort) → clear storage → redirect `/login`.

**Forgot / reset**
- Forgot screen: POST `/auth/forgot-password` → show generic "check your email" regardless of result.
- Reset screen at `/reset-password?token=...`: read token from query, POST `/auth/reset-password` with token + new password. On success → redirect `/login`.

**Change password (settings)**
- POST `/auth/change-password` with current + new. Surface `400` message / `errors.new_password`.

---

## 5. Summary table

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/auth/login` | public | email + password → JWT + user |
| GET | `/api/auth/me` | protected | current user (refresh hydrate) |
| POST | `/api/auth/logout` | protected | end session (stateless) |
| POST | `/api/auth/forgot-password` | public | email reset link |
| POST | `/api/auth/reset-password` | public | set new password via token |
| POST | `/api/auth/change-password` | protected | change while logged in |
