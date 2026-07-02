EquiLedger - Phased To-Do List
Legend: [KEEP] works as-is · [REWORK] modify existing code · [NEW] build from scratch · [KILL] remove

Phase 0 - Foundations & security (must precede everything)

[REWORK] imageUpload.js - remove file.makePublic(). Objects become private; serve via signed URLs from the API. (Critical: you're currently storing PPS numbers and IDs world-readable.)
[NEW] Signed-URL endpoint - generate short-TTL GCS signed URLs on demand for receipt viewing/export.
[NEW] organisations table - id, name, type ('personal'|'business'), owner_account_id, subscription_level, renewal_date, is_auto_renew, payment_method.
[REWORK] users table → accounts - add org_id (FK, never null), org_role ('owner'|'member'), platform_role ('user'|'super_admin'). Move billing fields out to organisations.
[NEW] Migration script - each existing user becomes a personal org of one; preserve any existing inviter_id groupings instead of splitting them.
[REWORK] authMiddleware.js - split the single role axis into org-role vs platform-role checks; add a tenant-scoping middleware that verifies the requester's org_id matches the resource's org_id (super_admin bypasses).
[REWORK] GCS object keys - org_{id}/{year}/{receipt_id}.{ext} instead of flat ids/. Enables per-tenant lifecycle + export + delete.
[REWORK] Every model query (expenseModel, userModel) - scope by org_id, not just user_id.

Phase 1 - Signup paths & UI rework (the phase you're on)

[NEW] Two-path signup - "Just me" (auto-creates personal org) vs "My business/I manage others" (named business org, owner role). Both produce an org.
[NEW] Next.js PWA with Carbon (@carbon/react), purple primary via token override ($interactive, $button-primary, $link-primary, $focus → purple ramp).
[NEW] PWA manifest + service worker (installable, offline shell, camera permission).
[NEW] Home screen - Carbon Tile stat cards (tax-year expenses/income/net, receipts pending), @carbon/charts-react by category, recent activity.
[NEW] Transactions screen - single DataTable with expense/income filter, TableToolbar (search + Export), row edit/delete via overflow menu, Add button.
[NEW] Settings screen - profile, tier, currency, retention info.
[KILL] Separate Expensescreen / Incomescreen / CreateExpense / CreateIncome / native swipe actions (replaced by the unified table).
[KEEP] Express API, JWT issuance (gf.js), Cloud Run deploy, Postgres.
[KEEP / optional KILL] Expo repo - keep only if you still want native builds; otherwise retire once PWA ships.

Phase 2 - Camera-first capture + receipt cleanup (+ OCR auto-fill, built-but-dormant)
(Pipeline order: capture → [crop: deferred] → binarise → [OCR: mock-only, flag-gated] → compress → store.)
Shipping default is MANUAL entry: capture + clean + store a cheap image, user fills the fields.
The "numbers read for you" OCR magic is deliberately deferred (no paid provider, no API key) until validated.
See docs/phase-2-capture.md for the full pipeline, model, endpoints, and the flags to switch OCR on later.

[DONE] Add-expense flow opens the camera immediately (native <input capture>); "Skip photo" falls back to the blank manual form (unchanged behaviour).
[DEFERRED] Edge detection + perspective crop - no-op seam + TODO in receiptCleanup.js (OpenCV findContours + warpPerspective). Deferred to avoid a finicky native dep on node:20-alpine; a missed crop beats one that cuts off the total.
[DONE] Stored image - sharp auto-orient + resize (max 2200px) + JPEG q85. The stored/served receipt is the legible compressed original (decompresses for the user automatically on download). Binarisation to 1-bit B&W is kept as an OCR-only throwaway (receiptCleanup.binarise), NOT stored - storing the binarised copy made downloads blurry/illegible.
[DONE] Receipts ↔ expenses split - new receipts table; one receipt → many expense line items (expenses.receipt_id, nullable). Manual no-photo expenses still allowed; legacy receipt_image_url kept for backward compat.
[DONE/DORMANT] OCR adapter seam - OcrProvider interface + MockOcrProvider (only impl) + HostedOcrProvider stub (Veryfi/Tabscanner/Eagle Doc/Azure, EU residency). getOcrProvider() reads OCR_PROVIDER (default 'none' = disabled). Not wired into the live flow.
[DONE/DORMANT] Auto-fill form from OCR JSON with per-field confidence indicators - coded behind OCR_AUTOFILL_ENABLED / NEXT_PUBLIC_OCR_AUTOFILL_ENABLED (default false). raw OCR result reserved in receipts.parsed_data (jsonb). Off = the user just types.
[DONE] receipts table carries merchant_name, tax_amount, parsed_data (jsonb), ocr_confidence, receipt_status ('pending'|'reviewed'|'none', default 'reviewed'); expenses gain receipt_id, merchant_name, tax_amount.

Phase 3 - Storage cost optimisation

[NEW] Compression on ingest - re-encode to WebP/AVIF (or keep the tiny binarised version as the record). Slots into the upload middleware after binarisation.
[NEW] GCS lifecycle rules - Standard → Nearline (~90d) → Coldline (1yr) → Archive, keyed off the org_{id}/{year}/ prefix.
[NEW] Retention policy - per-org configurable (default to your market's tax-record period; verify current Revenue/HMRC figure before hard-coding), auto-delete past retention, surface "records retained until YYYY" in Settings.

Phase 4 - Monetisation

[NEW] Tiers - Trial (capped) / Standard / Premium (Sage export, bulk zip, colder retention, accountant admin).
[NEW] Stripe integration - wire to existing subscription_level/renewal_date/is_auto_renew/payment_method (now on organisations); webhooks for status.
[REWORK] Feature gating middleware - checks org tier before allowing gated actions.

Phase 5 - Export & integrations

[KEEP] Excel + image-zip (gf.js generateExcel, imageDownload.js) - expose as clean endpoints.
[NEW] CSV export (same data path).
[NEW] Sage export adapter + pluggable export-adapter interface (Xero/QuickBooks next).
[REWORK] Receipt-by-ID fetch + bulk zip - wire into the Transactions toolbar Export button.

Phase 6 - Accountant admin overview  [DONE - see docs/phase-3-accountant-dashboard.md]

Shipped as the "Phase 3 accountant workspace". The three relationship types, the
accountant_org_links table, and the accessible-set scoping rule are documented in
docs/phase-3-accountant-dashboard.md.

[DONE] accountant_org_links (migration 007) + organisations.is_accountant_practice (manual/DB-only flag, paid later).
[DONE] Client invite (kind='client'): invitee creates their OWN isolated org + an active link back to the practice; accountant never joins it.
[DONE] Dedicated /accountant/* endpoints (list clients + stats, client transactions, export zip/csv, revoke) - every request verifies an active link (assertClientAccess) before returning data; revoked/missing link = 403.
[DONE] Clients workspace + read-only client detail (reuses TransactionsTable), Team tab (org-admin member management), landing "For accountants" link.
[KEEP] getUsersByInviterId, /accountant/users (legacy member grouping) - superseded for the Team view by getUsersByOrgId.

Phase 3.1 - Accountancy firms (multiple accountants) [DONE]
[DONE] Self-serve firm signup (is_accountant_practice flag at signup) → signer is admin/owner.
[DONE] Per-accountant client ownership via accountant_org_links.created_by: admin (owner)/super_admin see all firm clients, member accountants see only their own (assertClientAccess, getClientsWithStats, getAccessibleOrgIds).
[DONE] Admin invites accountants (existing owner-only invite-member) + admin reassigns clients (PATCH /accountant/clients/:id/assign).
[DONE] Frontend: signup firm checkbox, Clients admin "Accountant" column + Reassign, Team tab firm copy. Seed adds a staff accountant + split ownership.

Phase 6 - GA readiness: the last 20% [DONE - see docs/phase-6-ga-readiness.md; plan was docs/plans/phase-6-ga-readiness-plan.md]
[DONE] PR1 Tiers & gating - migration 010 (trial/standard, billing_status, trial_ends_at + 30-day default, stripe ids), computed entitlements (practice free & always active; practice-linked clients = covered seats; past_due keeps access), write-only 402 gate on /expenses /receipts /assets behind BILLING_ENFORCED (default false; fails open; super_admin bypass), GET /billing/status.
[DONE] PR2 Stripe - checkout (solo price vs per-seat qty), customer portal, webhooks (express.raw mount BEFORE json parser, signature-verified, per-event errors swallowed), seat-quantity sync on client signup/revoke (never fails the request), Settings billing card + trial banner + public /pricing. Fully inert without STRIPE_* keys.
[DONE] PR3 Hardening + verification - helmet, global 300/15min + strict 10/15min auth limiters (skip in test; proven live: 11th login 429), CORS_ORIGINS, validateEnv fail-fast prod boot, unauthenticated /health above the limiters, migration 011 email_verified_at (invite signups auto-verified; existing users grandfathered; 24h signed link; 7-day grace; resend endpoint; login 403 code email_unverified) behind REQUIRE_EMAIL_VERIFICATION. Also fixed broken resetPassword (called non-existent model fn).
[DONE] PR4 Baseline + ops - 000_baseline now CREATES the core schema IF NOT EXISTS: fresh Postgres -> migrate:up alone -> boot -> smoke PASSED (no-op on prod); Sentry behind SENTRY_DSN; request IDs (AsyncLocalStorage -> winston + x-request-id header); graceful SIGTERM drain (proven); docs/runbook-production.md.
[DONE] PR5 Legal - /terms + /privacy templates with [COMPANY DETAILS] placeholders (founder must fill + get reviewed), required signup consent checkbox, Settings retention line (Irish 6-year rule), landing/pricing/auth footer links, essential-cookies-only notice.
[DONE] Verification - 171 backend tests / 15 suites, lint + frontend build green; 010/011 up->down->up; live E2E scripts/e2e-phase6.mjs 23 checks ALL PASSED (covered-seat collapse/restore, 402-write-not-read, webhook sig rejection, verification lifecycle); Phase 5 tax E2E re-run under enforced billing ALL PASSED.
[TODO - GA day] Fill legal placeholders; create Stripe prices + webhook endpoint; set STRIPE_*, CORS_ORIGINS, SENTRY_DSN; flip BILLING_ENFORCED=true (runbook has the checklist).
[BUSINESS] Pilot with 2–3 practices runs in parallel - no code required.

Phase 5 - Irish tax engine (the Hill 3 moat) [DONE - see docs/phase-5-tax-engine.md]
[DONE] Capital allowances / wear & tear engine - 12.5% straight-line over 8 years, €24k passenger-car cap, disposal cutoff; computed on demand, never stored (services/tax/wearAndTear.js).
[DONE] Asset register (migration 009 assets table) - an expense is capital iff an assets row references it; capture-form "Capital item" toggle writes expense+asset in ONE transaction; PATCH is_capital tri-state; standalone opening assets via /assets CRUD.
[DONE] VAT treatment - organisations.vat_status (registered / not / flat-rate farmer), per-year flat-rate addition table, VAT 58 reclaim prompt from vat58-flagged categories (services/tax/vat.js).
[DONE] Form 11 pre-sort - revenue expenses bucketised into the real "extracts from accounts" lines, capital-linked expenses excluded (services/tax/form11.js).
[DONE] Tax summary - GET /reports/tax-summary (own org) + GET /accountant/clients/:id/tax-summary (link-gated); one shape powers the trader page, the client tab, and the export sheets.
[DONE] Export pack - accountant zip/Excel gains Tax summary + Capital allowances + VAT sheets and a Capital column (Excel + CSV).
[DONE] Frontend - /reports Tax summary page (schedule + asset register management), client-detail Tax summary tab, Clients readiness badges ("nothing to chase"), Settings VAT status, capital chip in the transactions table.
[TODO] Balancing allowances/charges on disposal; CO₂-banded car cap; flat-rate % check each Budget.

Phase 4 - Super-admin platform dashboard [DONE - see docs/phase-4-super-admin.md]
[DONE] /admin/* surface (requirePlatformRole) - platform overview (all orgs/users/firms + totals), all-orgs + all-users listings.
[DONE] Type-selectable invite (regular user vs accountant→firm) via platform invite token.
[DONE] Suspend/reactivate users + orgs (migration 008 organisations.status; users.account_status), enforced at login.
[DONE] GDPR hard-delete cascades (org + user) incl. stored receipt images (storage.deleteObject); self-target + owner-with-members guards.
[DONE] Frontend Admin dashboard + nav gating; drill into any org via the read-only client-detail view. Seed adds super@rian.dev.