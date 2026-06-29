# Staff & Roles API — Frontend Integration Guide

Hand this to the frontend team. Everything needed to integrate the Staff module.

---

## 0. Basics

- **Base URL:** `http://localhost:3000/api`
- **Auth:** Every request needs a JWT.
  Header: `Authorization: Bearer <token>`
  Missing/expired token → `401`.
- **Content-Type:** `application/json` for all bodies.
- **IDs:** `id` and `office_id` are **strings** (Mongo ObjectId, e.g. `665f1c2e8b3a4c1d2e3f4a5b`). Treat as opaque.
  `role_id` is an **integer** (1–5).

### Success envelope (every 2xx)
```json
{ "success": true, "message": "string", "data": <payload> }
```

### Error envelope (every 4xx/5xx)
```json
{ "success": false, "statusCode": 400, "message": "string", "errors": { "field": ["msg"] } }
```
`errors` is present only on validation failures (`400`). For `401/404/409` only `message` is sent.

---

## 1. Staff endpoints

### 1.1 Create — `POST /api/staff`

Request body:
```json
{
  "first_name": "Ali",
  "last_name": "Khan",
  "email": "ali@example.com",
  "password": "StrongPass@123",
  "mobile_no": "03001234567",
  "cnic_no": "35202-1234567-1",
  "office_id": "665f1c2e8b3a4c1d2e3f4a5b",
  "role_id": 2,
  "address": "Lahore",
  "biography": "optional text",
  "profile_photo": "data:image/png;base64,iVBORw0KGgo...",
  "staff_status": "active"
}
```

- `biography`, `profile_photo`, `staff_status` are optional.
- `profile_photo` = base64 data URL on input; server stores the file and returns a **URL string** (or `null`).
- `staff_status` defaults to `active`.

Success → `201`:
```json
{
  "success": true,
  "message": "Staff created",
  "data": {
    "id": "665f...",
    "first_name": "Ali",
    "last_name": "Khan",
    "email": "ali@example.com",
    "mobile_no": "03001234567",
    "cnic_no": "35202-1234567-1",
    "office_id": "665f1c2e8b3a4c1d2e3f4a5b",
    "role_id": 2,
    "address": "Lahore",
    "biography": "optional text",
    "profile_photo": "http://localhost:3000/uploads/staff/uuid.png",
    "staff_status": "active",
    "created_at": "2026-06-15T10:00:00.000Z",
    "updated_at": "2026-06-15T10:00:00.000Z"
  }
}
```
> `password` is **never** returned in any response.

Errors:
- `409` — `{ "message": "email already exists" }` or `"cnic_no already exists"`.
- `400` — validation (see §3) or `office_id`/`role_id` does not exist.

### 1.2 List — `GET /api/staff`

Query params (all optional):

| param | default | notes |
|-------|---------|-------|
| `page` | `1` | |
| `limit` | `10` | |
| `search` | — | matches `first_name`, `last_name`, `email`, `mobile_no` |
| `role_id` | — | filter by role (int) |
| `sort` | `created_at` | one of `first_name｜email｜mobile_no｜staff_status｜created_at｜updated_at` |
| `order` | `desc` | `asc｜desc` |

Example: `GET /api/staff?page=1&limit=10&search=ali&role_id=2&sort=first_name&order=asc`

Success → `200` (**slim rows only**):
```json
{
  "success": true,
  "message": "Staff fetched",
  "data": {
    "data": [
      { "id": "665f...", "full_name": "Ali Khan", "staff_status": "active", "mobile_no": "03001234567", "email": "ali@example.com" }
    ],
    "total": 42,
    "page": 1,
    "limit": 10
  }
}
```
> List returns `full_name` (server concatenates first + last). Full fields come from the detail endpoint.

### 1.3 Detail — `GET /api/staff/:id`
Success → `200`, `data` = full staff object (same shape as create response, no password).
`404` if not found.

### 1.4 Full update — `PUT /api/staff/:id`
Body = same shape as create.
- `password` optional → omit or send `""` to **keep existing**.
- `profile_photo` omit/`null`/`""` → **keep existing**; send a new base64 to replace.

Success → `200`, `data` = updated full object.

### 1.5 Partial update — `PATCH /api/staff/:id`
Body = any subset of the create fields. Main use: toggle status.
```json
{ "staff_status": "inactive" }
```
Success → `200`, `data` = updated full object.

### 1.6 Delete one — `DELETE /api/staff/:id`
Success → `200`:
```json
{ "success": true, "message": "Staff deleted", "data": { "id": "665f...", "deleted": true } }
```
`404` if not found.

### 1.7 Bulk delete — `DELETE /api/staff`
Body:
```json
{ "ids": ["665f...", "665a..."] }
```
Success → `200`:
```json
{ "success": true, "message": "Staff deleted", "data": { "deleted_count": 2 } }
```

---

## 2. Dropdown endpoints

### 2.1 Roles — `GET /api/roles`
```json
{
  "success": true,
  "message": "Roles fetched",
  "data": [
    { "id": 1, "role": "Admin" },
    { "id": 2, "role": "Editor" },
    { "id": 3, "role": "Moderator" },
    { "id": 4, "role": "Contributor" },
    { "id": 5, "role": "Subscriber" }
  ]
}
```
Use `id` as `role_id` when creating/updating staff. **Stop hardcoding roles** — fetch from here.

### 2.2 Offices — `GET /api/offices`
Already exists. Use each office `id` as `office_id` for staff.

---

## 3. Validation rules (frontend should mirror for UX; server enforces)

| field | rule |
|-------|------|
| `first_name`, `last_name`, `address` | required, non-empty |
| `email` | required, valid email, unique |
| `password` | **on create:** required. min 12 chars, ≥1 uppercase, ≥1 digit, ≥1 special `!@#$%^&*(),.?":{}|<>`. **on edit:** optional (empty = keep) |
| `mobile_no` | required |
| `cnic_no` | required, format `XXXXX-XXXXXXX-X` (regex `^\d{5}-\d{7}-\d$`), unique |
| `office_id` | required, must be an existing office id |
| `role_id` | required integer, must be an existing role id |
| `biography` | optional |
| `profile_photo` | optional, base64 data URL (png/jpg/jpeg/webp/gif), max 2 MB |
| `staff_status` | `active｜inactive`, default `active` |

On validation failure server returns `400` with `errors`, e.g.:
```json
{
  "success": false,
  "statusCode": 400,
  "message": "Validation failed",
  "errors": {
    "password": ["password must be at least 12 characters", "password must contain at least one digit"],
    "cnic_no": ["cnic_no must match the format XXXXX-XXXXXXX-X"]
  }
}
```
Map each `errors[field]` array under its form field.

---

## 4. Field-name contract (do NOT rename)
`first_name, last_name, email, password, mobile_no, cnic_no, office_id, role_id, address, biography, profile_photo, staff_status`.
List row uses `full_name`.

---

## 5. Integration checklist
1. Attach `Authorization: Bearer <token>` on every call (reuse the offices interceptor).
2. Read the success envelope as `res.data.data` for staff payloads; list pagination is `res.data.data.data` + `total/page/limit`.
3. On `400`, surface `errors[field]` per input.
4. Populate role dropdown from `GET /api/roles`, office dropdown from `GET /api/offices`.
5. Send `profile_photo` as a base64 data URL; render the returned URL string.
6. On edit, leave password blank to keep it unchanged.
