EquiLedger — Phased To-Do List
Legend: [KEEP] works as-is · [REWORK] modify existing code · [NEW] build from scratch · [KILL] remove

Phase 0 — Foundations & security (must precede everything)

[REWORK] imageUpload.js — remove file.makePublic(). Objects become private; serve via signed URLs from the API. (Critical: you're currently storing PPS numbers and IDs world-readable.)
[NEW] Signed-URL endpoint — generate short-TTL GCS signed URLs on demand for receipt viewing/export.
[NEW] organisations table — id, name, type ('personal'|'business'), owner_account_id, subscription_level, renewal_date, is_auto_renew, payment_method.
[REWORK] users table → accounts — add org_id (FK, never null), org_role ('owner'|'member'), platform_role ('user'|'super_admin'). Move billing fields out to organisations.
[NEW] Migration script — each existing user becomes a personal org of one; preserve any existing inviter_id groupings instead of splitting them.
[REWORK] authMiddleware.js — split the single role axis into org-role vs platform-role checks; add a tenant-scoping middleware that verifies the requester's org_id matches the resource's org_id (super_admin bypasses).
[REWORK] GCS object keys — org_{id}/{year}/{receipt_id}.{ext} instead of flat ids/. Enables per-tenant lifecycle + export + delete.
[REWORK] Every model query (expenseModel, userModel) — scope by org_id, not just user_id.

Phase 1 — Signup paths & UI rework (the phase you're on)

[NEW] Two-path signup — "Just me" (auto-creates personal org) vs "My business/I manage others" (named business org, owner role). Both produce an org.
[NEW] Next.js PWA with Carbon (@carbon/react), purple primary via token override ($interactive, $button-primary, $link-primary, $focus → purple ramp).
[NEW] PWA manifest + service worker (installable, offline shell, camera permission).
[NEW] Home screen — Carbon Tile stat cards (tax-year expenses/income/net, receipts pending), @carbon/charts-react by category, recent activity.
[NEW] Transactions screen — single DataTable with expense/income filter, TableToolbar (search + Export), row edit/delete via overflow menu, Add button.
[NEW] Settings screen — profile, tier, currency, retention info.
[KILL] Separate Expensescreen / Incomescreen / CreateExpense / CreateIncome / native swipe actions (replaced by the unified table).
[KEEP] Express API, JWT issuance (gf.js), Cloud Run deploy, Postgres.
[KEEP / optional KILL] Expo repo — keep only if you still want native builds; otherwise retire once PWA ships.

Phase 2 — Camera-first capture + receipt cleanup (+ OCR auto-fill, built-but-dormant)
(Pipeline order: capture → [crop: deferred] → binarise → [OCR: mock-only, flag-gated] → compress → store.)
Shipping default is MANUAL entry: capture + clean + store a cheap image, user fills the fields.
The "numbers read for you" OCR magic is deliberately deferred (no paid provider, no API key) until validated.
See docs/phase-2-capture.md for the full pipeline, model, endpoints, and the flags to switch OCR on later.

[DONE] Add-expense flow opens the camera immediately (native <input capture>); "Skip photo" falls back to the blank manual form (unchanged behaviour).
[DEFERRED] Edge detection + perspective crop — no-op seam + TODO in receiptCleanup.js (OpenCV findContours + warpPerspective). Deferred to avoid a finicky native dep on node:20-alpine; a missed crop beats one that cuts off the total.
[DONE] Stored image — sharp auto-orient + resize (max 2200px) + JPEG q85. The stored/served receipt is the legible compressed original (decompresses for the user automatically on download). Binarisation to 1-bit B&W is kept as an OCR-only throwaway (receiptCleanup.binarise), NOT stored — storing the binarised copy made downloads blurry/illegible.
[DONE] Receipts ↔ expenses split — new receipts table; one receipt → many expense line items (expenses.receipt_id, nullable). Manual no-photo expenses still allowed; legacy receipt_image_url kept for backward compat.
[DONE/DORMANT] OCR adapter seam — OcrProvider interface + MockOcrProvider (only impl) + HostedOcrProvider stub (Veryfi/Tabscanner/Eagle Doc/Azure, EU residency). getOcrProvider() reads OCR_PROVIDER (default 'none' = disabled). Not wired into the live flow.
[DONE/DORMANT] Auto-fill form from OCR JSON with per-field confidence indicators — coded behind OCR_AUTOFILL_ENABLED / NEXT_PUBLIC_OCR_AUTOFILL_ENABLED (default false). raw OCR result reserved in receipts.parsed_data (jsonb). Off = the user just types.
[DONE] receipts table carries merchant_name, tax_amount, parsed_data (jsonb), ocr_confidence, receipt_status ('pending'|'reviewed'|'none', default 'reviewed'); expenses gain receipt_id, merchant_name, tax_amount.

Phase 3 — Storage cost optimisation

[NEW] Compression on ingest — re-encode to WebP/AVIF (or keep the tiny binarised version as the record). Slots into the upload middleware after binarisation.
[NEW] GCS lifecycle rules — Standard → Nearline (~90d) → Coldline (1yr) → Archive, keyed off the org_{id}/{year}/ prefix.
[NEW] Retention policy — per-org configurable (default to your market's tax-record period; verify current Revenue/HMRC figure before hard-coding), auto-delete past retention, surface "records retained until YYYY" in Settings.

Phase 4 — Monetisation

[NEW] Tiers — Trial (capped) / Standard / Premium (Sage export, bulk zip, colder retention, accountant admin).
[NEW] Stripe integration — wire to existing subscription_level/renewal_date/is_auto_renew/payment_method (now on organisations); webhooks for status.
[REWORK] Feature gating middleware — checks org tier before allowing gated actions.

Phase 5 — Export & integrations

[KEEP] Excel + image-zip (gf.js generateExcel, imageDownload.js) — expose as clean endpoints.
[NEW] CSV export (same data path).
[NEW] Sage export adapter + pluggable export-adapter interface (Xero/QuickBooks next).
[REWORK] Receipt-by-ID fetch + bulk zip — wire into the Transactions toolbar Export button.

Phase 6 — Accountant admin overview

[KEEP] getUsersByInviterId, /accountant/users route, invite flow.
[NEW] Admin page listing an accountant's client orgs; selecting one re-scopes app (read + export) to that org.
[REWORK] Tenant-scoping middleware (from Phase 0) — allow an accountant org to access client orgs it manages.