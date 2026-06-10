# Office REST API

Base URL: `http://localhost:3000/api`
Auth: `Authorization: Bearer <JWT>` on **every** endpoint.
Swagger UI: `http://localhost:3000/api/docs`

## Response envelope

Success:

```json
{ "success": true, "message": "Office created", "data": { } }
```

Error:

```json
{ "success": false, "statusCode": 400, "message": "Validation failed", "errors": { "office_email": ["office_email must be an email"] } }
```

## Status codes

| Code | Meaning |
|------|---------|
| 200 | OK (get/list/update/delete) |
| 201 | Created |
| 400 | Validation / bad logo / bad id |
| 401 | Missing / invalid token |
| 404 | Office not found |
| 409 | Duplicate office_email |

## Endpoint list

| Method | Path | Purpose |
|--------|------|---------|
| GET | /api/offices | List (page, limit, search, sort, order) |
| GET | /api/offices/:id | Single office, full detail |
| POST | /api/offices | Create |
| PUT | /api/offices/:id | Full update |
| PATCH | /api/offices/:id | Partial update |
| DELETE | /api/offices/:id | Soft-delete one |
| DELETE | /api/offices | Bulk soft-delete `{ ids: [...] }` |

---

## GET /api/offices

Query: `page` (default 1), `limit` (default 10), `search`, `sort` (default `created_at`), `order` (`asc`/`desc`, default `desc`).
Search matches `office_name`, `office_email`, `office_mobile_no`.
List rows include only: `id, office_name, office_status, office_mobile_no, office_email`.

`GET /api/offices?page=1&limit=10&search=downtown&sort=office_name&order=asc`

```json
{
  "success": true,
  "message": "Offices fetched",
  "data": {
    "data": [
      {
        "id": "665f1c2a9b1e4a0012ab34cd",
        "office_name": "Downtown Office",
        "office_status": "active",
        "office_mobile_no": "+61400000000",
        "office_email": "office@example.com"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 10
  }
}
```

## GET /api/offices/:id

```json
{
  "success": true,
  "message": "Office fetched",
  "data": {
    "id": "665f1c2a9b1e4a0012ab34cd",
    "office_name": "Downtown Office",
    "office_email": "office@example.com",
    "office_mobile_no": "+61400000000",
    "membership_level": "gold",
    "membership_type": "monthly",
    "licence_no": "LIC-12345",
    "approved": false,
    "office_status": "active",
    "office_address": "123 Main St, Sydney NSW",
    "biography": "Long biography text...",
    "office_logo": "http://localhost:3000/uploads/offices/3f2c....png",
    "created_at": "2026-06-10T02:00:00.000Z",
    "updated_at": "2026-06-10T02:00:00.000Z"
  }
}
```

## POST /api/offices

Request:

```json
{
  "office_name": "Downtown Office",
  "office_email": "office@example.com",
  "office_mobile_no": "+61400000000",
  "membership_level": "gold",
  "membership_type": "monthly",
  "licence_no": "LIC-12345",
  "approved": false,
  "office_status": "active",
  "office_address": "123 Main St, Sydney NSW",
  "biography": "Long biography text...",
  "office_logo": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
}
```

`201` → full office object (logo returned as URL, never base64).
Duplicate email → `409`. Logo > 2 MB or non-image mime → `400`.

## PUT /api/offices/:id — full update

Send the whole object (same shape as POST). Empty/absent `office_logo` keeps the existing logo; a new base64 string replaces it. → `200`.

## PATCH /api/offices/:id — partial update

```json
{ "approved": true, "office_status": "inactive" }
```

→ `200` full updated office.

## DELETE /api/offices/:id

```json
{ "success": true, "message": "Office deleted", "data": { "id": "665f...", "deleted": true } }
```

## DELETE /api/offices — bulk

Request:

```json
{ "ids": ["665f1c2a9b1e4a0012ab34cd", "665f1c2a9b1e4a0012ab34ce"] }
```

```json
{ "success": true, "message": "Offices deleted", "data": { "deleted_count": 2 } }
```

---

## Logo handling

- Input: base64 data URL string in `office_logo` (POST/PUT/PATCH JSON body). No multipart, no separate endpoint.
- Allowed mime: png, jpeg/jpg, webp, gif. Other → `400`.
- Max 2 MB decoded → `400`.
- Decoded + written to `uploads/offices/`, served at `/uploads/offices/<file>`.
- DB stores only the URL. Responses return the URL.
- On update: empty/null = keep existing; new base64 = replace.

## DTOs

**CreateOfficeDto** — required: `office_name`, `office_email` (email, unique), `office_mobile_no`, `membership_level` (gold|premium|silver), `membership_type` (monthly|yearly), `office_address`. Optional: `licence_no`, `approved` (default false), `office_status` (active|inactive, default active), `biography`, `office_logo` (base64).

**UpdateOfficeDto** — `PartialType(CreateOfficeDto)`: every field optional, same validation rules when present. Used by both PUT and PATCH.

## Soft delete

Rows carry `deleted_at` (default null). Delete sets it to now. All reads filter `deleted_at: null`. Email uniqueness is a partial index over non-deleted rows, so a deleted office's email can be reused.

## Generating a test JWT

Secret is `JWT_SECRET` in `.env`. Any token signed with it passes the guard, e.g.:

```bash
node -e "console.log(require('jsonwebtoken').sign({sub:'1',name:'tester'}, process.env.JWT_SECRET||'change-me-in-prod', {expiresIn:'1d'}))"
```
