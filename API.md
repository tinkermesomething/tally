# Tally API

A token-authenticated REST layer for a machine/agent client (not the browser
session) to read and update budget data. Separate from the human OIDC login -
this exists specifically so another Claude instance (or any script) can
manage the app without a browser.

## Auth

Every request needs:

```
Authorization: Bearer <TALLY_API_TOKEN>
```

`TALLY_API_TOKEN` lives in this app's `.env` (local dev: `.env.local`;
deployed: `GITEA/docker/tally/.env`). Missing/wrong token → `401`.
Errors are always `{ "error": "message" }`.

Base URL: `https://tally.home.internal/api/v1` (deployed) or
`http://localhost:3000/api/v1` (local dev).

## Endpoints

### `GET /grid?year=2026`
Full grid: categories (with `.children`, `.months`, `.yearTotalPence`,
`.monthlyAveragePence`), `subtotalByMonth`, `wagesByMonth`,
`availableByMonth`, `remainingByMonth`, `yearTotal`. `year` defaults to the
current year. `months` is keyed by month number (`1`-`12`); a month with no
entry is simply absent from the object.

### `GET /years`
`{ "years": number[] }` - every year with data, plus the current and next
calendar year.

### `POST /categories`
Create a category (top-level or a subcategory).
```json
{ "name": "Disney+", "parentId": null, "groupName": "Subscriptions",
  "isAnnual": false, "annualMonth": null }
```
Set `parentId` to an existing top-level category's id to nest it as a child
(it rolls up automatically once every one of that parent's non-annual
children has an entry for a given month). `groupName` only matters for
top-level categories - it drives the Reports pie chart.

### `PATCH /categories/:id`
Rename and/or move to a different group.
```json
{ "name": "New name", "groupName": "Utilities" }
```
Both fields optional; only send what you want to change.

### `PUT /categories/:id/entries`
Set the planned amount for one month.
```json
{ "year": 2026, "month": 4, "pounds": 45.00 }
```

### `PATCH /categories/:id/entries`
Mark a month's entry paid/unpaid.
```json
{ "year": 2026, "month": 4, "paid": true }
```

### `POST /expenses`
Log an actual expense against a category (tracked separately from the
planned amount - shows as "£X left" in the UI).
```json
{ "categoryId": 12, "pounds": 23.50, "entryDate": "2026-09-26",
  "note": "weekly shop" }
```

### `POST /income/sources`
```json
{ "name": "Side gig" }
```

### `PUT /income/entries`
```json
{ "incomeSourceId": 3, "year": 2026, "month": 9, "pounds": 4800 }
```

### `GET /debt/people`
`{ "people": [{ id, name, balancePence, entryCount }] }`. Positive balance =
you owe them; negative = they owe you.

### `POST /debt/people`
```json
{ "name": "Roberto" }
```

### `GET /debt/people/:id`
Full ledger: `{ person, entries: [...], balancePence }`, entries oldest-first
with a running balance.

### `POST /debt/people/:id/entries`
```json
{ "pounds": 50, "entryDate": "2026-09-26", "direction": "repayment",
  "note": "bank transfer" }
```
`direction` is `"loan"` (increases what you owe) or `"repayment"` (decreases
it).

## Notes for an agent using this API

- All money in requests is **pounds** (decimal, e.g. `23.50`), not pence -
  the API converts internally. Responses use **pence** (integers) to match
  the UI's own data layer exactly, so sum/compare without float rounding.
- Nothing here is destructive - there's no delete/archive endpoint yet.
  Categories, income sources and people can only be created and edited.
- `entryDate` is always an ISO date string (`YYYY-MM-DD`).
