# Phase 2 — Camera-first receipt capture

Phase 2 makes adding an expense **camera-first** and splits a **receipt** from the
**expense line items** captured off it (1 receipt → N expenses). The captured
image is cleaned server-side and stored as a tiny 1-bit PNG. The user fills in the
fields **manually** — this is the shipping default. An OCR auto-fill capability is
**built but dormant** behind off-by-default flags, so switching it on later is a
config flip, not a rebuild.

Hill this serves: *"A sole trader can turn a paper receipt into trusted, tax-ready
records in seconds."* Phase 2 delivers fast capture + a clean, cheap stored image +
correct multi-line records. The "numbers read for you" magic is deliberately
deferred until validated.

## Pipeline (load-bearing order)

```
capture → [perspective-crop: deferred] → compress → store   (+ binarise → OCR, dormant)
```

- **capture** — browser native camera via `<input type="file" accept="image/*"
  capture="environment">` (file picker fallback on desktop), or "Skip photo".
- **perspective-crop** — *deferred.* `backend/src/utils/receiptCleanup.js` has a
  no-op `cropReceipt()` seam and a `TODO` for OpenCV `findContours` +
  `warpPerspective`. Deferred to avoid a finicky native dependency on the
  `node:20-alpine` image. A missed crop beats one that cuts off the total.
- **compress + store** — `sharp`: auto-orient (EXIF) → resize to a bounded long
  edge (`MAX_EDGE` 2200px) → re-encode to a **JPEG (quality 85, colour)**. This
  legible compressed image is what gets stored and served back. Image formats are
  already "compress on store / decompress on view", so the browser decompresses
  the JPEG transparently on download — the user sees the real receipt. Written
  privately via the storage driver under the Phase 0 tenant key scheme
  `org_{orgId}/{year}/{receiptId}.jpg`; reads go through short-lived signed URLs
  (never public).
- **binarise (OCR only, not stored)** — `binarise()` produces a destructive 1-bit
  black/white PNG. It is **only** ever used as a throwaway input to OCR (better for
  text recognition), never stored or shown to the user. Binarising before storing
  was the original "cost win" but made the downloaded receipt blurry/illegible, so
  the stored copy is the compressed original instead.
- **OCR** — *dormant.* Only runs if `getOcrProvider()` returns non-null, i.e. when
  `OCR_PROVIDER !== 'none'`. Default is `none`, so no provider is constructed or
  called and `binarise()` is never invoked on the live flow.

## Data model: receipts ↔ expenses

Migration `backend/migrations/006_receipts_and_line_items.sql` (additive, reversible;
existing rows untouched):

- **`receipts`** — `id`, `user_id` (FK users), `image_object_path` (object KEY, not a
  URL), `parsed_data jsonb` (OCR output; null now), `ocr_confidence` (null now),
  `receipt_status` ∈ `pending|reviewed|none` (default **`reviewed`**), `merchant_name`,
  `receipt_date`, `total_amount`, `tax_amount`, `currency`, timestamps.
- **`expenses`** — added `receipt_id` (FK receipts, **nullable**), `merchant_name`,
  `tax_amount`. **`receipt_image_url` is kept** for backward compatibility (legacy
  rows and the legacy single-photo path still work).
- Indexes: `expenses(receipt_id)`, `receipts(user_id)`.

`receipt_status` defaults to `reviewed` because the user confirms everything
manually today; `pending` is reserved for the future OCR path (a receipt exists but
hasn't been confirmed). The local-dev `backend/scripts/seed.js` schema mirrors this.

Tenant scoping reuses the `orgPredicate` user→org subquery from
`expenseModel.js`/`receiptModel.js`: a row is in scope when its `user_id` belongs to
the caller's org; super-admin passes `orgId = null` to bypass.

## Endpoints (`backend/src/routes/receiptRoutes.js`)

All `authenticateToken + scopeToOrg`, org-scoped. Mounted at `/receipts` in
`src/index.js`.

| Method & path                 | Purpose |
| ----------------------------- | ------- |
| `POST /receipts/process`      | Clean + store the captured image, create a `receipts` row, return `{ receiptId, signedUrl, parsedData, ocrConfidence, receiptStatus }`. OCR branch is dormant (skipped while `OCR_PROVIDER=none`). |
| `POST /receipts/:id/expenses` | Create one or more expense line items (`{ items: [...] }`) linked to the receipt. This is what "save" calls. |
| `GET /receipts/:id/image-url` | Fresh short-lived signed URL for the receipt image. |
| `GET /receipts/:id`           | Receipt + its linked expense line items. |

## OCR adapter seam (`backend/src/services/ocr/`)

Built now, **inert** by default:

- `OcrProvider.js` — interface: `extract(buffer) → { merchant, date, total, tax,
  currency, lineItems?, raw, fieldConfidence }`.
- `MockOcrProvider.js` — the only implementation built now; canned plausible data +
  fake confidence scores. Used only to develop/test the dormant path.
- `HostedOcrProvider.js` — stub that throws `NotImplemented`; lists candidate vendors
  (Veryfi / Tabscanner / Eagle Doc / Azure Document Intelligence — **EU data
  residency required**).
- `index.js` — `getOcrProvider()` reads `OCR_PROVIDER`: `none` → `null` (disabled),
  `mock` → `MockOcrProvider`, `hosted` → `HostedOcrProvider`.

## Frontend flow

- The transactions **Add** button opens `ReceiptCaptureDialog` (camera capture +
  "Skip photo"). On capture it `POST /receipts/process`, shows *"Cleaning up
  receipt…"*, then opens `TransactionFormDialog` with the cleaned thumbnail attached.
- The form supports **multiple line items** (each its own expense linked to the one
  receipt). The single-item case stays simple; extra lines appear only on "Add line
  item". Save posts the array to `POST /receipts/:id/expenses`.
- **Skip photo** opens the existing blank manual form unchanged (no `receipt_id`).
- Legacy rows (`receipt_image_url`, no `receipt_id`) still display and edit.
- The transactions table/list associate line items from one receipt via
  `merchant_name` + a receipt indicator; the thumbnail opens the shared image.

## Enabling OCR auto-fill later (the flag flip)

OCR is built but dormant. To switch it on:

| Flag | Where | Default | Set to enable |
| ---- | ----- | ------- | ------------- |
| `OCR_PROVIDER` | backend `.env` | `none` | `mock` (canned) or `hosted` (once implemented) |
| `OCR_AUTOFILL_ENABLED` | backend `.env` | `false` | `true` |
| `NEXT_PUBLIC_OCR_AUTOFILL_ENABLED` | frontend `.env.local` | `false` | `true` |

With `OCR_PROVIDER=mock` + `NEXT_PUBLIC_OCR_AUTOFILL_ENABLED=true`, `/receipts/process`
returns `parsedData`, the receipt is created `pending`, and the form pre-fills fields
and shows per-field confidence indicators (low-confidence warning on editable fields).
With the flags off (the default) none of that renders and no OCR is called. **No paid
OCR provider is wired; do not enable `hosted` until a vendor with EU data residency is
implemented.**

## Tests (`backend/test/`)

- `receiptModel.test.js` — receipt org scoping; `getExpensesByReceiptId` scoping;
  line items link to a receipt; manual path stores a null `receipt_id`.
- `ocrAndCleanup.test.js` — `cleanReceipt` returns a legible JPEG + `cropped:false`;
  `binarise` (OCR-only) returns a 1-bit PNG;
  `getOcrProvider()` disabled by default / returns mock for `mock`; `MockOcrProvider`
  shape.
- `receiptController.test.js` — `/receipts/process` cleans + stores without invoking
  any OCR provider; multiple line items share one `receipt_id`; tenant isolation
  (a receipt in another org 404s); super-admin bypass.
