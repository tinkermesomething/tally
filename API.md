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
`.monthlyAveragePence`), `wagesByMonth`, and two distinct pairs, each an
array of 12 (plus a matching field in `yearTotal`) - don't confuse them:
- `plannedByMonth` / `availableByMonth` - what's budgeted, and income minus
  that. Stable, forward-looking - doesn't move based on what's been paid.
- `actuallySpentByMonth` / `leftToSpendByMonth` - only what's actually been
  paid/logged, and income minus that. Moves in real time through the month.

`subtotalByMonth` also exists (spent-if-known-else-planned, blended) - it's
what the grid's own SUBTOTAL row uses, not meant for anything else; prefer
the two pairs above. `year` defaults to the current year. `months` is keyed
by month number (`1`-`12`); a month with no entry is simply absent from the
object.

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

### `DELETE /categories/:id`
Archives the category (and, if it has any, its children too). Soft-delete -
all its history/entries are preserved, it just disappears from the grid and
Reports going forward.

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

### `GET /expenses?year=&month=&categoryId=`
List logged expenses. `year` required. `month` optional (omit for the whole
year). `categoryId` optional - narrows to one cell's entries (requires
`month` too when set); omitting it lists across every category.
```json
{ "entries": [{ "id": 7, "categoryId": 12, "categoryName": "Groceries",
  "year": 2026, "month": 9, "amountPence": 2350, "note": "weekly shop",
  "entryDate": "2026-09-26" }] }
```

### `POST /expenses`
Log an actual expense against a category (tracked separately from the
planned amount - shows as "£X left" in the UI). Also marks that category's
month paid, same as ticking the checkbox - logging an expense and settling
it are the same real-world fact.
```json
{ "categoryId": 12, "pounds": 23.50, "entryDate": "2026-09-26",
  "note": "weekly shop" }
```

### `PATCH /expenses/:id`
Edit a logged expense. All fields optional - only send what changed.
```json
{ "pounds": 25.00, "note": "corrected", "entryDate": "2026-09-27" }
```

### `DELETE /expenses/:id`
**Real, permanent delete** - unlike everything else in this API, a logged
expense is not soft-deleted. If it was the last expense logged for that
category/month, that month's `paid` flag is also reverted to false (it no
longer reflects anything real).

### `POST /income/sources`
```json
{ "name": "Side gig" }
```

### `DELETE /income/sources/:id`
Archives the source. Past entries are preserved.

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

### `DELETE /debt/people/:id`
Archives the person. Their ledger history is preserved, just hidden from the
Debt page going forward.

### `POST /bank-sync/sync`
Fetches new transactions for every active linked bank account and stages
them into the Review queue (`/review` in the UI) - exact-id deduped against
anything already staged, auto-categorized where an explicit rule or learned
pattern matches, otherwise left `pending_review`. Not automatic - nothing
else triggers this, so hit it manually or from a cron job.
```json
{ "results": [{ "bankAccountId": 1, "displayName": "NatWest - current",
  "staged": 4 }] }
```

## Notes for an agent using this API

- All money in requests is **pounds** (decimal, e.g. `23.50`), not pence -
  the API converts internally. Responses use **pence** (integers) to match
  the UI's own data layer exactly, so sum/compare without float rounding.
- Every `DELETE` is a soft-delete (an `archived` flag) - nothing is ever
  actually destroyed. There's no way to un-archive via the API yet; that's
  only in the Settings UI.
- `entryDate` is always an ISO date string (`YYYY-MM-DD`).
