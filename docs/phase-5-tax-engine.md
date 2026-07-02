# Phase 5 - Irish tax engine: capital allowances, VAT treatment, tax-season pack

This phase builds the moat from `design-thinking.md` (Hill 3): the genuinely
fiddly Irish tax handling - **capital allowances** on equipment/machinery/
vehicles, **VAT treatment** including the flat-rate farmer scheme - and deepens
Hill 1's wow: the accountant opens a client and the year is **already sorted the
way the tax return asks for it** (Form 11 buckets, a wear & tear schedule, the
VAT position), on screen and in the export.

## The one rule everything leans on

**An expense is CAPITAL iff an `assets` row references it** (`assets.expense_id`).
There is no flag column and no second source of truth:

- Ticking *Capital item* on a transaction writes the expense **and** its
  asset-register row in one transaction (`createExpensesWithAssets`).
- Un-ticking it (PATCH `is_capital:false`) deletes the register row - the
  expense reverts to an ordinary revenue expense.
- Deleting the expense cascades the asset (FK `ON DELETE CASCADE`).
- Capital-linked expenses are **excluded** from revenue category totals and the
  Form 11 buckets - they are claimed through wear & tear instead - and totalled
  separately as capital expenditure.
- Wear & tear is **computed on demand, never stored** (pure functions of the
  register rows + a year), so there is no schedule state to drift.

## Tax rules encoded (verify each Budget)

| Rule | Where |
|---|---|
| Wear & tear 12.5% straight-line × 8 years (TCA 1997 s.284); starts in the acquisition year; none from the disposal year | `services/tax/wearAndTear.js` |
| Passenger-car cost cap €24,000 (`asset_type='motor_vehicle'` only - lorries/tractors/horseboxes are uncapped `plant_machinery`) | same |
| Flat-rate addition by year (2023 5.0% · 2024 4.8% · 2025 5.1%, latest-known fallback) | `services/tax/vat.js` |
| VAT 58 farmer reclaim prompt (buildings/fencing/drainage spend) via `vat58` category flags | same |
| Form 11 "extracts from accounts" buckets (Purchases / Wages / Sub-contractors / Professional / Motor & travel / Repairs / Other) | `services/tax/form11.js` |

Deliberately out of scope (documented, not forgotten): balancing
allowances/charges on disposal (the register records date + proceeds for the
accountant), CO₂-emissions banding of the car cap, monthly pro-rating.

## Data model (migration `009_tax_engine.sql`, additive/reversible)

- **`assets`** - `id`, `user_id` (FK users, CASCADE), `expense_id` (FK expenses,
  CASCADE, **nullable** - null = standalone/opening asset), `description`,
  `category`, `asset_type` ∈ `plant_machinery|motor_vehicle`, `cost`,
  `currency`, `acquired_date`, `disposal_date`, `disposal_proceeds`, timestamps.
  Indexes on `user_id`, `expense_id`.
- **`organisations.vat_status`** ∈ `not_registered|registered|flat_rate_farmer`
  (default `not_registered`; owner-editable in Settings; validated in the
  controller so a typo 400s).
- Category template nodes may carry `capital: true` (suggests the capital
  toggle) and `vat58: true` - suggestions only, never enforced; older stored
  trees fall back to `KNOWN_CAPITAL_SLUGS` in `frontend/src/lib/org.ts`.
- Tenant scoping is the standard `orgPredicate` user→org subquery
  (`assetModel.js`); expense reads now expose `is_capital` via an `EXISTS`
  subquery.

## Endpoints

| Method & path | Guard | Purpose |
|---|---|---|
| `GET /assets?year=` | own org | Register + computed W&T schedule for the year. |
| `POST /assets` | own org | Standalone (opening) asset. |
| `PATCH /assets/:id` | org-scoped | Edit / record a disposal. |
| `DELETE /assets/:id` | org-scoped | Remove from register (linked expense reverts to revenue). |
| `GET /reports/tax-summary?year=` | own org (token) | Full tax picture: totals, byCategory, form11, capitalAllowances, vat. |
| `GET /accountant/clients/:id/tax-summary?year=` | `assertClientAccess` | Same picture for a linked client. |

Capture carries the marker end-to-end: `POST /expenses` and
`POST /receipts/:id/expenses` accept `is_capital` + `asset_type`
(sanitised, never trusted raw); the receipt multi-line save is now a single
transaction. `PATCH /expenses/:id` treats `is_capital` as tri-state
(true=upsert, false=remove, absent=untouched).

## Export (the January artifact)

`gf.generateExcel(expenses, imagesDir, filePath, taxSummary?)` - the accountant
export now ships four sheets: **Expenses** (with Merchant/Tax/**Capital**
columns), **Tax summary** (Form 11 shape), **Capital allowances** (the
schedule), **VAT**. The CSV gains a `Capital` column. A tax-summary failure
never kills the export (logged, sheets skipped).

## Frontend

- **Transaction form**: picking a capital-flagged category pre-ticks *Capital
  item* (asset-type select appears); works per-line in receipt mode; editing
  prefills from `is_capital` and can un-mark.
- **Tax summary page** (`/reports`, business orgs): year selector, stat tiles,
  Form 11 table, W&T schedule, VAT card, and the **asset register** with
  add / edit / dispose / remove.
- **Client detail**: `Transactions | Tax summary` segmented view - the summary
  tab is the same `TaxSummaryView` fed by the accountant endpoint.
- **Clients dashboard**: per-row readiness badge (green *Up to date* ≤60d /
  amber *Gone quiet* / red *No records*) derived from existing stats - the
  "nothing to chase" glance.
- **Settings**: VAT status (with plain-English hints).
- Transactions table shows a small *Capital* chip on register-linked rows.

## Tests

`wearAndTear.test.js` (rates, cap, exhaustion + rounding, disposal, schedule),
`taxEngine.test.js` (Form 11 bucketing incl. zero-bucket shape; VAT per status,
year table, custom vat58 flags), `assets.test.js` (model scoping incl.
super-admin bypass and whitelist; transactional create/rollback; PATCH
tri-state; controller validation), `taxSummary.test.js` (capital exclusion
math; own-org token scoping; accountant link gate 403 / super-admin bypass).
Suite: 112 passing.

## Seed

`demo@airgead.dev` org gets the schema; **Galway Equine** is a
`flat_rate_farmer` with a horsebox capital expense + linked asset (the
accountant demo shows a live schedule); **Murphy Retail** is `registered`.
