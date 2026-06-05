# Phase 2 — Camera-first receipt capture (manual entry, OCR built-but-dormant)

## Context

Today `expenses` holds `receipt_image_url` directly, so one photo = one expense and there is no
cleaned-image story. The hill for Phase 2 is: *"A sole trader can turn a paper receipt into trusted,
tax-ready records in seconds."* That means **fast capture → a clean, cheap stored image → correct
multi-line records**, with the "numbers read for you" OCR magic deliberately **deferred** until
validated (no paid provider, no API key, no live call now).

This change:
1. Splits receipts from expense line items (1 receipt → many expenses).
2. Cleans the captured image server-side (binarise to a tiny 1-bit PNG) before storing.
3. Builds an OCR adapter **seam** wired only to a mock, behind an off-by-default flag — a clean
   future switch-on, not a dependency we pay for today.
4. Makes the Add-expense flow camera-first with a manual multi-line form.

**Pipeline order (load-bearing):** capture → [perspective-crop: deferred TODO] → binarise →
[OCR: mock-only, flag-gated] → compress → store.

### Stack corrections to the brief (use the real stack)
- Frontend is **shadcn/ui + Radix + Tailwind**, NOT Carbon. Confidence/warnings use existing
  `@/components/ui/*` primitives + `lucide-react` icons, not Carbon components.
- The form is `frontend/src/components/transaction-form-dialog.tsx`, NOT `TransactionFormModal.tsx`.
- Camera: **native `<input type="file" accept="image/*" capture="environment">`** (confirmed), not
  live getUserMedia.
- Crop: **binarise-only now via `sharp`, perspective-crop left as a TODO** (confirmed) — avoids a
  finicky native OpenCV dep on the `node:20-alpine` image.

### Key facts confirmed from the codebase
- `users.id`, `expenses.id`, `expenses.user_id` are all **uuid**. `expenses.amount` is `numeric(12,2)`.
  `expenses` has no `org_id` — tenant scoping is via the user→org subquery (`orgPredicate`).
- Migrations: **node-pg-migrate** SQL format with `-- Up Migration` / `-- Down Migration` markers,
  `IF NOT EXISTS` guards, constraints wrapped in `DO $$ ... pg_constraint ... END$$`. Latest is
  `005`; next is `006`. Scripts: `npm run migrate:up` / `migrate:down`.
- Storage: `backend/src/utils/storage.js` exposes `putObject(objectPath, buffer, contentType)`,
  `exists`, `createReadStream`, `getSignedUrl(objectPath, ttl)`. Dual driver (local/gcs), same object
  keys. Key scheme `org_{orgId}/{year}/{receiptId}.{ext}` (see `imageUpload.js`).
- Routes: registered in `backend/src/index.js` (`app.use('/expenses', expenseRoutes)` etc). Each
  route file does `router.use(injectPool)` then `router.use(authenticateToken, scopeToOrg)`.
- `req.user = { userId, role, orgId, orgRole, platformRole }`. Super-admin bypass via
  `isSuperAdmin(req)`; scope helper pattern is `scopeOrgIdFor(req)` in `expenseController.js`.
- Tests: **Jest + sinon**, fully mocked (no live DB). `req.pool` stubbed, `req.user` set manually,
  models/storage stubbed. Files in `backend/test/` (`tenantIsolation.test.js` is the template).
- Frontend: all calls go through `/api/proxy/[...path]`; `api` object in `frontend/src/lib/api.ts`;
  category options via `categoryOptions(tree, side)` in `lib/org.ts` + `useOrgCategories()`;
  `FileUpload` emits a base64 data URL; `getReceiptUrl(id)` gives a 5-min signed URL; session via
  `useSession()`. `sharp` is NOT yet a backend dependency.

---

## PR 1 — Data layer (migration + models), tested

### Migration `backend/migrations/006_receipts_and_line_items.sql`
Follow the `005`/`001` style exactly (`-- Up Migration` / `-- Down Migration`, `IF NOT EXISTS`,
guarded constraints). **Additive only — do not migrate existing `expenses` rows.**

Up:
- `CREATE TABLE IF NOT EXISTS receipts (` — `id uuid PK DEFAULT gen_random_uuid()`,
  `user_id uuid NOT NULL` (FK → `users(id)`, matching the uuid type; add FK in a guarded `DO $$`
  block), `image_object_path text` (GCS/local object **key**, never a public URL),
  `parsed_data jsonb` (null now), `ocr_confidence numeric` (null now),
  `receipt_status text DEFAULT 'reviewed'` with guarded
  `CHECK (receipt_status IN ('pending','reviewed','none'))`, `merchant_name text`,
  `receipt_date date`, `total_amount numeric`, `tax_amount numeric`, `currency text`,
  `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`.
  (Default `'reviewed'` because the user fills everything in manually now; `'pending'` is reserved
  for the future OCR path.)
- `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_id uuid` + guarded FK → `receipts(id)`
  (nullable — manual no-photo expenses still allowed). Add `merchant_name text`, `tax_amount numeric`.
  **Keep `receipt_image_url`** (backward compat — do not drop).
- `CREATE INDEX IF NOT EXISTS idx_expenses_receipt_id ON expenses(receipt_id);`
  `CREATE INDEX IF NOT EXISTS idx_receipts_user_id ON receipts(user_id);`

Down: drop the two indexes, drop the guarded FK + added expenses columns
(`receipt_id`, `merchant_name`, `tax_amount`), `DROP TABLE IF EXISTS receipts;`.

> Also mirror the new columns/table into `backend/scripts/seed.js` `SCHEMA_SQL` so a fresh local DB
> (which bypasses migrations) matches.

### New `backend/src/models/receiptModel.js`
Reuse the `orgPredicate(alias, orgId, paramIndex)` pattern from `expenseModel.js` (a row is in scope
when its `user_id` belongs to the caller's org; `orgId` null/undefined bypasses for super-admin).
Functions: `createReceipt(pool, receipt)`, `getReceiptById(pool, id, orgId)`,
`updateReceipt(pool, id, fields, orgId)`, `getReceiptsByUserId(pool, userId, orgId)`. Same
try/catch + `logger` style as `expenseModel.js`.

### Extend `backend/src/models/expenseModel.js`
- `createExpense`: accept/persist `receipt_id`, `merchant_name`, `tax_amount` — **append** to the
  destructure + INSERT column/value lists; do **not** reorder existing params.
- `updateExpense` / `partialUpdateExpense`: likewise persist `merchant_name`, `tax_amount`
  (append params, keep existing positions/`orgPredicate` indices correct).
- Add `getExpensesByReceiptId(pool, receiptId, orgId)` using `orgPredicate`.

### Tests (`backend/test/`, Jest + sinon, mocked)
- `receiptModel` org scoping: `getReceiptById` for an out-of-org user returns null / is scoped
  (assert the `orgPredicate` subquery + param is included).
- `getExpensesByReceiptId` returns only the linked rows and is org-scoped.

---

## PR 2 — Image cleanup + OCR seam (built, not wired live), tested

### Add dependency
Add `sharp` to `backend/package.json` (prebuilt musl binaries install cleanly on `node:20-alpine`;
no Dockerfile change needed).

### New `backend/src/utils/receiptCleanup.js`
- `cleanReceipt(inputBuffer)` → `{ binarisedBuffer, cropped: boolean }`.
- **Perspective crop: deferred.** Leave a clearly-commented `// TODO: perspective crop (OpenCV
  findContours + warpPerspective) — deferred to avoid native dep on alpine` and a no-op
  `cropReceipt()` seam that currently returns the full frame; always `cropped: false` for now.
  (Brief's rule: a missed crop beats one that cuts off the total.)
- **Binarise with sharp:** grayscale → optional light blur → adaptive/conservative threshold to
  **1-bit black/white**, output **PNG** (palette/1-bit — lossless, tiny for bilevel; never JPEG for
  B&W text). Threshold tunable via a constant, default conservative to preserve faint thermal text.

### New OCR adapter seam under `backend/src/services/ocr/`
- `OcrProvider.js` — interface/JSDoc: `extract(imageBuffer) → { merchant, date, total, tax,
  currency, lineItems?, raw, fieldConfidence }`, where `lineItems` is
  `[{ description, amount, category? }]` (supports future multi-line).
- `MockOcrProvider.js` — the **only** implementation now: returns canned plausible data (a merchant,
  today's date, a total, a couple of line items) with fake `fieldConfidence` scores.
- `HostedOcrProvider.js` — stub whose `extract` throws `NotImplemented`, with a comment listing
  candidate vendors (Veryfi / Tabscanner / Eagle Doc / Azure Document Intelligence — **EU data
  residency required**).
- `index.js` factory `getOcrProvider()` reads `process.env.OCR_PROVIDER` (default `'none'`):
  `'none'` → returns `null` (OCR fully disabled), `'mock'` → `MockOcrProvider`, `'hosted'` →
  `HostedOcrProvider` (throws until implemented).

### Config
- `backend/.env.example`: add `OCR_PROVIDER=none` and `OCR_AUTOFILL_ENABLED=false`.
- Surface `OCR_AUTOFILL_ENABLED` to the frontend (see PR 4 — via a small public config value the app
  can read; default false).

### Tests
- `MockOcrProvider.extract()` returns the documented shape (merchant/date/total/tax/currency +
  `lineItems[]` + `fieldConfidence`) — unit test of the seam even though it's not wired live.
- `receiptCleanup.cleanReceipt()` on a small fixture image returns a non-empty `binarisedBuffer` and
  `cropped: false`.
- `getOcrProvider()` returns `null` when `OCR_PROVIDER` unset/`none`, `MockOcrProvider` for `mock`.

---

## PR 3 — Endpoints (OCR branch dormant)

### New `backend/src/controllers/receiptController.js` + `backend/src/routes/receiptRoutes.js`
Route file mirrors `expenseRoutes.js`: `router.use(injectPool)` then
`router.use(authenticateToken, scopeToOrg)`. Register in `backend/src/index.js` with
`app.use('/receipts', receiptRoutes)`. Use `scopeOrgIdFor(req)` + `denyIfCrossOrg` patterns from
`expenseController.js`.

Endpoints (all `authenticateToken + tenantScope`, org-scoped):
- **`POST /receipts/process`** — accepts the raw captured image (same base64 data-URI convention as
  `imageUpload.js`). Flow: decode → `cleanReceipt()` → **(OCR only if `getOcrProvider()` returns
  non-null — currently `none`, so skipped entirely)** → `storage.putObject` of the binarised PNG
  under `org_{orgId}/{year}/{receiptId}.png` → `receiptModel.createReceipt` (store the **object
  path**, `receipt_status='reviewed'`, `parsed_data`/`ocr_confidence` null) → return
  `{ receiptId, signedUrl }` (`getSignedUrl`). Code the OCR branch so flipping `OCR_PROVIDER` later
  activates it (write `parsed_data`, `ocr_confidence`, `receipt_status='pending'`), but it's dormant.
- **`POST /receipts/:id/expenses`** — accepts an **array** of line items; verifies the receipt is in
  scope; creates one expense per item via `expenseModel.createExpense` with `receipt_id` set; leaves
  receipt `status='reviewed'`. Returns the created expenses. (This is what "save" calls.)
- **`GET /receipts/:id/image-url`** — fresh signed URL via `getSignedUrl` (scope-checked).
- **`GET /receipts/:id`** — receipt + its linked expense line items (`getExpensesByReceiptId`).

### Tests (`backend/test/`, Jest + sinon)
- `POST /receipts/process` with OCR disabled: stub `storage.putObject` + `receiptModel.createReceipt`
  + `receiptCleanup`; assert receipt created, image stored under the org key, **no OCR provider
  invoked** (spy on `getOcrProvider`/provider.extract — never called).
- `POST /receipts/:id/expenses` with a 2-item array → two expenses created, both with the same
  `receipt_id`.
- Tenant isolation: user A cannot `GET /receipts/:id` belonging to user B's org (scoped null/403).

---

## PR 4 — Frontend camera-first flow + manual multi-line form (auto-fill coded but flag-off)
**Do not commit / no PR — the user will handle git for this one.**

### API + config (`frontend/src/lib/`)
- Add `api.receipts`: `process(imageDataUrl) → { receiptId, signedUrl }`,
  `createExpenses(receiptId, items[])`, `getImageUrl(receiptId)`, `get(receiptId)` — all via
  `/api/proxy/receipts/...`.
- Add `merchant_name`/`tax_amount`/`receipt_id` to the `Expense` type and create payloads.
- Expose `OCR_AUTOFILL_ENABLED` (default `false`) as a frontend constant/public env
  (`NEXT_PUBLIC_OCR_AUTOFILL_ENABLED`) so the auto-fill UI is a pure flag flip later.

### Capture entry (`frontend/src/app/(app)/transactions/page.tsx`)
- The **Add** button opens a capture step (isolate this handler/component for a clean future swap to
  live camera or auto-fill). Use `<input type="file" accept="image/*" capture="environment">`
  (native camera on mobile, file picker fallback on desktop) — reuse/extend `FileUpload`.
- Always show a visible **"Skip photo"** that opens the existing blank manual form with **exactly**
  today's behaviour (no `receipt_id`). Preserve the `?add=1` deep-link.
- On capture: `POST /receipts/process`, show a brief "Cleaning up receipt…" state, then open the form
  with the cleaned-image thumbnail (signed URL) attached and `receiptId` in hand.

### Form (`frontend/src/components/transaction-form-dialog.tsx`)
- Keep the **single-item path dead simple** (current UX). Add an "Add line item" affordance that
  expands to multiple rows; each row = title/description, amount, and a category `Select` from the
  org template (`categoryOptions(tree, side)` via `useOrgCategories()`). Each row becomes its own
  expense linked to the one `receipt_id`.
- On save with a `receiptId`: `POST /receipts/:id/expenses` with the array. Without a `receiptId`
  (skip-photo / legacy edit): keep the existing `api.expenses.create/update` path unchanged.
- **Auto-fill (dormant):** write the form so that *if* `OCR_AUTOFILL_ENABLED` were true *and*
  `/receipts/process` returned `parsed_data`, it would pre-fill fields + show per-field confidence
  indicators (shadcn helper text + a `lucide-react` warning icon on low-confidence fields, all
  editable). With the flag off, none of that renders and the user just types. No OCR call is made
  when the flag is off.

### Transactions table/list
- In `transactions-table.tsx` / `transaction-list.tsx` / `transaction-row.tsx`, make line items from
  the same receipt visually associable (show `merchant_name` + a receipt indicator icon). Tapping the
  indicator opens the shared receipt image (reuse the signed-URL `getImageUrl`/existing `ReceiptThumb`
  lazy-fetch pattern).
- **Backward compat:** legacy rows (`receipt_image_url`, no `receipt_id`) still render and edit via
  the existing path.

---

## Docs
- Update `plan.md` Phase 2 section to reflect: manual entry is the shipping default; OCR is
  **built-but-dormant**; perspective crop deferred.
- Add `docs/phase-2-capture.md` documenting: the pipeline (capture → crop[deferred] → binarise →
  OCR[mock/dormant] → compress → store), the receipts↔expenses model, and the exact env flags to
  switch OCR on later (`OCR_PROVIDER`, `OCR_AUTOFILL_ENABLED`, `NEXT_PUBLIC_OCR_AUTOFILL_ENABLED`).
- Per memory `document-approved-plans.md`: persist this approved plan into `docs/` as well.

---

## Verification
- **Backend unit/integration (Jest + sinon):** `cd backend && npm test`. New suites cover: receipt
  created + image stored on `/receipts/process` with OCR disabled (provider never called); multiple
  line items link to one `receipt_id`; tenant isolation (user A ≠ user B's receipt); skip/manual path
  creates an expense with no `receipt_id`; `MockOcrProvider` shape.
- **Migration round-trip:** `cd backend && npm run migrate:up` then `npm run migrate:down` cleanly
  (against a local Postgres / `npm run seed`).
- **Manual e2e (local, `STORAGE_DRIVER=local`, `OCR_PROVIDER=none`):** run backend + `npm run dev`
  in frontend, log in as the seeded demo user, hit **Add** → take/pick a photo → confirm
  "Cleaning up receipt…" → cleaned 1-bit PNG thumbnail shows → fill 2 line items → save → both
  appear in the table sharing a merchant + receipt indicator → tap indicator opens the cleaned image.
  Confirm **Skip photo** still creates a plain expense unchanged. Confirm no OCR/auto-fill UI renders.
- **Flag check (do not enable live OCR):** with `OCR_PROVIDER=mock` +
  `NEXT_PUBLIC_OCR_AUTOFILL_ENABLED=true` locally, verify the dormant auto-fill path pre-fills from
  the mock and shows confidence indicators — then revert both to defaults.
