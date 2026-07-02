# Phase 5 - Irish tax engine: capital allowances, VAT treatment, tax-season pack

## Context (why this phase, per the design thinking)

Phases 0–4 shipped the platform: isolated client orgs, camera-first capture, the
accountant workspace/firms, and the super-admin surface. What is NOT built yet is
the thing `docs/design-thinking.md` calls **the moat** (Hill 3):

> "An Irish equine/agricultural business and its accountant can handle the
> genuinely fiddly stuff - capital allowances on equipment, livestock, motor/
> mileage, flat-rate farmer VAT - with a tool built for their tax reality."

and the deepening of Hill 1's wow - Liam opens the dashboard and *nothing needs
chasing*, then one export gives him the **pre-sorted hard part**, not just a flat
transaction list. Storyboard panel 4 ("the tool already knows it's a
capital-allowance item, not a straight expense") and panel 6 ("one-click export…
the afternoon that used to be January") are this phase.

Scope: **capital allowances (wear & tear) + asset register**, **org VAT
treatment** (registered / not / flat-rate farmer), a **tax summary** (Form-11
shaped category buckets, capital-allowances schedule, VAT position) surfaced to
both the trader and the accountant, richer **export sheets**, and a **client
readiness status** on the Clients dashboard. Explicitly out of scope (documented,
not forgotten): balancing allowances/charges on disposal, CO₂-emissions-banded
car caps, bank feeds, e-invoicing output (Hill 4 positioning only).

## Irish tax facts encoded (verify each Budget)

- **Wear & tear**: plant & machinery, 12.5% straight-line over 8 years
  (TCA 1997 s.284). Allowance starts in the year the asset comes into use
  (we use the year of `acquired_date`); none from the year of disposal on.
- **Motor vehicles (passenger cars)**: allowable cost capped at the specified
  amount **€24,000**. (Emissions banding deliberately simplified away in v1 -
  the cap is applied to `asset_type='motor_vehicle'` only; lorries/horseboxes/
  tractors are `plant_machinery`, uncapped.)
- **Flat-rate farmer addition** (unregistered farmers): per-year rate table
  `2023: 5.0% · 2024: 4.8% · 2025: 5.1%`, latest-known fallback. Flat-rate
  farmers do not reclaim input VAT; they may reclaim VAT on farm
  buildings/structures, fencing, drainage via **VAT 58** - we total the spend in
  vat58-flagged categories as a prompt.
- Tax year = calendar year (already the convention: `TAX_YEAR()` in
  `accountantController`, year windows in `expenseModel`).

## Key facts confirmed from the codebase

- Migrations: SQL files with `-- Up Migration` / `-- Down Migration`,
  `IF NOT EXISTS` guards, FKs in guarded `DO $$` blocks. Latest is `008`; next
  `009`. Local dev schema is mirrored in `backend/scripts/seed.js` `SCHEMA_SQL`.
- Tenant scoping: `orgPredicate(alias, orgId, paramIndex)` in
  `expenseModel`/`receiptModel` (user→org subquery; `orgId=null` = super-admin
  bypass). Controllers use `scopeOrgIdFor(req)`; accountant access via
  `assertClientAccess` (active link + ownership) - reuse, don't reinvent.
- Org-level reads for the accountant use `getExpensesByOrgId(AndYear)`.
- `organisations.categories` is an org-editable jsonb tree seeded from
  `config/categoryTemplates.js`; controller validation (`isNodeArray`) tolerates
  extra node keys, so nodes can carry metadata flags.
- Export: `gf.generateExcel(expenses, imagesDir, filePath)` (ExcelJS) + zip via
  `imageDownload.js`; CSV built inline in `accountantController.toCsv`.
- Frontend: shadcn/Radix/Tailwind; API via `/api/proxy`; nav gating via props on
  `AppSidebar` computed in `app/(app)/layout.tsx`; forms in
  `transaction-form-dialog.tsx` (single + receipt multi-line paths).
- Tests: Jest + sinon, fully mocked pool/models (`accountant.test.js` is the
  access-control template).

## Data model (migration `009_tax_engine.sql`, additive & reversible)

```
assets
  id                 uuid PK DEFAULT gen_random_uuid()
  user_id            uuid NOT NULL → users(id)            (guarded FK)
  expense_id         uuid NULL → expenses(id) ON DELETE CASCADE (guarded FK)
  description        text NOT NULL
  category           text                                  -- source category slug
  asset_type         text NOT NULL DEFAULT 'plant_machinery'
                     CHECK (asset_type IN ('plant_machinery','motor_vehicle'))
  cost               numeric(12,2) NOT NULL
  currency           text NOT NULL DEFAULT 'EUR'
  acquired_date      date NOT NULL
  disposal_date      date          -- disposal stops allowances (no balancing calc v1)
  disposal_proceeds  numeric(12,2)
  created_at / updated_at timestamptz

organisations.vat_status text NOT NULL DEFAULT 'not_registered'
  CHECK (vat_status IN ('not_registered','registered','flat_rate_farmer'))

indexes: assets(user_id), assets(expense_id)
```

Design choices:
- **An expense is "capital" iff an `assets` row references it.** No flag column
  on `expenses`; no dual source of truth. Deleting the expense cascades the
  asset; un-ticking "capital" deletes the asset row and the expense reverts to a
  revenue expense.
- Standalone assets (`expense_id` null) support opening balances / pre-app
  purchases, added from the Tax summary page.
- W&T is **computed, never stored** - a pure function of (cost, type,
  acquired/disposal dates, year), so there is no schedule state to drift.

### Category template metadata
Template nodes gain optional flags (suggestions for the UI, not enforced):
`capital: true` on equipment-like leaves (`equipment`, `machinery_purchase`,
`equipment_fixtures`, `tools_equipment`, `equipment_furniture`,
`tack_equipment`) and `vat58: true` on `building_fencing`. Older orgs have
stored trees without flags → the frontend falls back to a known-slug set
(`KNOWN_CAPITAL_SLUGS` in `lib/org.ts`).

## Tax engine (`backend/src/services/tax/`, pure + orchestrator)

- `wearAndTear.js` - `WT_RATE=0.125`, `WRITE_OFF_YEARS=8`,
  `MOTOR_COST_CAP=24000`; `allowableCost(asset)`;
  `allowanceForYear(asset, year)` (0 before acquisition year, 0 from the 9th
  year, 0 from the disposal year; final-year allowance absorbs rounding so the
  8 years sum exactly to allowable cost); `scheduleForYear(assets, year)` →
  per-asset rows `{ yearIndex 1..8, allowance, openingWdv, closingWdv, capped,
  disposed }` + totals.
- `vat.js` - flat-rate table + `vatSummary({ vatStatus, expenses,
  capitalExpenseIds, year })` → `{ vatStatus, flatRateAddition, vatOnPurchases,
  vatOnIncome, vat58EligibleSpend }` (vat58 spend only surfaced for
  flat-rate/unregistered farmers).
- `form11.js` - category-slug → Form 11 trading-account heading map
  (Purchases / Wages / Motor & travel / Repairs / Rent & rates / Light, heat &
  phone / Professional fees / Insurance / Other) with `bucketise(expenses)`;
  **capital-linked expenses are excluded from the buckets** (they get W&T
  instead) and totalled separately as capital expenditure.
- `taxSummaryService.js` - `buildTaxSummary(pool, orgId, year)`: pulls org (vat
  status + category tree for labels), the year's expenses, the org's assets →
  returns `{ year, vatStatus, totals { income, revenueExpenses,
  capitalExpenditure, wearAndTear, netBeforeAdjustments }, byCategory[],
  form11[], capitalAllowances { rows, totals }, vat }`. Powers both endpoints
  and the export sheets.

## Endpoints

| Method & path | Guard | Purpose |
|---|---|---|
| `GET /assets?year=` | own org | Org's asset register + computed schedule for the year. |
| `POST /assets` | own org | Standalone asset (opening balance). |
| `PATCH /assets/:id` | org-scoped | Edit description/type/cost/dates incl. disposal. |
| `DELETE /assets/:id` | org-scoped | Remove from register (linked expense stays, reverts to revenue). |
| `GET /reports/tax-summary?year=` | own org | Full tax summary for the caller's org. |
| `GET /accountant/clients/:clientOrgId/tax-summary?year=` | `assertClientAccess` | Same summary for a linked client org. |

Capture paths learn capital items (transactional):
- `POST /expenses` accepts `is_capital` + `asset_type` → expense + asset created
  in **one transaction** (`createExpenseWithAsset`).
- `POST /receipts/:id/expenses` items accept `is_capital`/`asset_type`; the
  whole multi-line save becomes one transaction.
- `PATCH /expenses/:id` accepts `is_capital` tri-state: `true` upserts the
  linked asset (cost/description follow the expense), `false` deletes it,
  omitted leaves it alone.
- `DELETE /expenses/:id` - DB cascade removes the linked asset.

Export upgrades (reusing the existing zip path):
- `gf.generateExcel(expenses, imagesDir, filePath, taxSummary?)` - optional 4th
  arg adds three sheets: **Tax summary** (Form 11 buckets, income, capital
  expenditure, W&T, net), **Capital allowances** (the schedule), **VAT**. The
  Expenses sheet + CSV gain a `Capital` column (from
  `taxSummary.capitalExpenseIds`).
- Both `exportClient` (accountant) and `getExcelDownloadByUserIdAndYear` (own
  org) build the summary and pass it; CSV keeps transactions-only + the new
  column.

## Frontend

- **Capture** (`transaction-form-dialog.tsx`): choosing a capital-flagged
  category auto-suggests "Capital item - claim over 8 years via the asset
  register" (checkbox, pre-ticked when flagged, always available); ticked shows
  an asset-type select (Plant & machinery / Motor vehicle (car)). Works on both
  the single path and per-line in receipt mode. `api` payloads carry
  `is_capital`/`asset_type`.
- **Tax summary page** (`app/(app)/reports/page.tsx`, nav "Tax summary", shown
  for business orgs): year selector; stat tiles (Income, Allowable expenses,
  Capital allowances, Est. profit before adjustments); Form 11 buckets table;
  capital-allowances schedule with **Add asset / edit / dispose / remove**
  (dialog); VAT position card (flat-rate addition %, VAT58 prompt when
  relevant).
- **Client detail** (`clients/[clientOrgId]/page.tsx`): Segmented
  `Transactions | Tax summary`; the summary tab reuses the same
  `TaxSummaryView` component fed from the accountant endpoint; Export
  unchanged (now richer).
- **Clients dashboard**: per-row **readiness status** derived from the
  existing stats (green "Up to date" ≤60d activity; amber "Gone quiet" >60d;
  red "No records" when 0 txns this year) - the all-green "nothing to chase"
  moment.
- **Settings**: VAT status select (business orgs) → `PATCH /organisations/:id`
  (`vat_status` added to `ORG_UPDATABLE_FIELDS`).

## Tests (Jest + sinon, mocked - no live DB)

- `wearAndTear.test.js` - year windows, motor cap, 8-year exhaustion with exact
  rounding, disposal cutoff, schedule totals.
- `taxEngine.test.js` - form11 bucketing excludes capital-linked expenses; VAT
  summary per status incl. flat-rate year table + vat58 spend.
- `assetModel.test.js` - orgPredicate scoping on read/update/delete.
- `assetLifecycle.test.js` - `POST /expenses` with `is_capital` runs one
  transaction (expense + asset, COMMIT); receipt multi-line with a capital line;
  PATCH `is_capital:false` deletes the asset; standalone asset CRUD scoping.
- `taxSummary.test.js` - own-org endpoint uses the caller's org; accountant
  endpoint 403s unlinked (data layer untouched) and passes super_admin;
  summary shape.
- Organisation: `vat_status` accepted by `updateOrg` whitelist.

## Seed & demo

`seed.js`: schema mirrors migration 009; Galway Equine gets a horsebox capital
expense + linked asset and `vat_status='not_registered'`; demo org gets one
equipment asset so the Tax summary page is populated on first login.

## Verification

- `cd backend && npm test` - all suites green.
- Migration round-trip `npm run migrate:up` / `migrate:down` clean.
- `cd frontend && npm run build` (types + lint) green.
- Manual e2e: add expense with capital category → asset appears in Tax summary
  schedule with year-1 allowance; un-tick via edit → gone; accountant opens
  client → Tax summary tab + export zip contains the three new sheets; Clients
  list shows readiness badges.
