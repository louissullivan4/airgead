# Phase 6 — GA readiness: billing, hardening, baseline, ops, legal

The commercial and operational layer on top of the finished product wedge
(capture → accountant workspace → Irish tax engine → export pack). Everything
here follows the OCR-seam discipline: **fully built, enforced by config** —
the app runs exactly as before until the GA flags flip. Launch day is an env
change, not a deploy gamble.

## The tier model (one twist)

Two tiers — **Trial** (30 days, full product, clock starts at org creation via
a column default) and **Standard** (paid). The twist that matches the go-to-
market: **an accountancy practice's own account is free; it pays per active
client seat**, and a client org linked (active `accountant_org_links` row) to
a paying practice is a **covered seat** — entitled without paying anything
itself. Solo orgs pay for themselves.

Entitlement is COMPUTED per request (`services/billing/entitlements.js`,
single SQL round trip), never stored, resolution order: practice → own
subscription (`active`/`trialing`/`past_due` all count — dunning must not
lock a paying customer out) → covered seat → unexpired trial → expired.

**Expired = read-only, never locked out.** The gate
(`middlewares/billing.js`) is mounted router-wide on `/expenses`, `/receipts`,
`/assets` but bites only on write verbs; reads, exports, settings, login and
all `/billing` routes stay open. It fails OPEN on infrastructure errors,
super_admin bypasses, and the whole thing is a no-op until
`BILLING_ENFORCED=true`.

## Stripe (inert without keys)

`stripeClient.js` returns null without `STRIPE_SECRET_KEY`; every billing
route answers 502 "not configured" and seat sync no-ops. With keys:

- `POST /billing/checkout-session` (owner-only): solo → `STRIPE_PRICE_SOLO`
  qty 1; practice → `STRIPE_PRICE_SEAT` qty = active links (min 1). Creates/
  reuses the Stripe customer, stamps `client_reference_id`/metadata with the
  org id.
- `POST /billing/portal-session` (owner-only): Stripe's hosted portal — we
  build no card UI ever.
- `POST /billing/webhook`: mounted in `src/index.js` with `express.raw`
  **before** the JSON body parser (signature verification needs exact bytes);
  no auth — the signature is the auth. Handles checkout completion and
  subscription create/update/delete; org lookup by our stamped id first,
  `stripe_customer_id` second; per-event errors are logged and 200'd.
- **Seat sync** (`seatSync.js`): after a client-invite signup and after a
  revoke, the practice's subscription-item quantity is set to its active-link
  count (prorated). Best-effort — never throws, self-heals on the next event.

Migration `010_billing.sql`: `billing_status` (+CHECK), `trial_ends_at`
(volatile default now()+30d — new orgs self-start their trial),
`stripe_customer_id`/`stripe_subscription_id`, `subscription_level`
constrained to `trial|standard` after folding legacy values.

## Frontend commerce

`api.billing` + `BillingStatus` type; the backend's `enforced:false` makes all
of it invisible pre-GA. Trial banner in the app layout (amber final week, red
read-only notice after expiry); Settings **Plan & billing** card (replaces
the dead "Free plan" card) with live status/seat count and checkout/portal
buttons; public **/pricing** page (solo €9/mo, seat €7/mo — display constants
in `lib/pricing.ts`, truth lives in Stripe) with the covered-seat FAQ, linked
from the landing header/footer.

## Hardening

helmet; global limiter 300/15min + strict 10/15min on login/register/
password-reset/resend-verification (skipped under `NODE_ENV=test`; factories
in `config/rateLimits.js`); CORS locked to `CORS_ORIGINS` when set;
`config/validateEnv.js` fails production boot on missing/short `JWT_SECRET`,
missing `DB_URL`/`FRONTEND_URL` (warns elsewhere); unauthenticated `/health`
(`SELECT 1` → 200/503) mounted above the limiters.

## Email verification (migration `011`)

`users.email_verified_at`; **anyone arriving via a signed invite token
(member/client/platform) is stamped verified at creation** — the invite
proved the inbox, so the accountant-distribution flow keeps zero friction.
Self-serve signups get a 24h signed link (`GET /users/verify-email` →
redirect `login?verified=1`) and a **7-day login grace**; after it, 403
`code:'email_unverified'` with an in-app resend banner and a login-page
resend path. Existing users were grandfathered verified by the migration.
`REQUIRE_EMAIL_VERIFICATION=false` disables the gate (dev). Mail failures
never fail signup. `resend-verification` answers identically for unknown
addresses (no enumeration).

## Schema baseline + ops

- **`000_baseline.sql` rewritten**: creates the pre-migration core (`users`,
  `expenses`, `user_invites`) `IF NOT EXISTS`. On prod it never runs (its
  pgmigrations row exists); on an empty database `npm run migrate:up` now
  bootstraps everything — verified live: fresh Postgres → migrations only →
  boot → register/login/expense/tax-summary smoke passed. Seed is demo-data
  only (header updated).
- **Sentry** behind `SENTRY_DSN` (module not even required without it).
- **Request IDs**: `middlewares/requestContext.js` (AsyncLocalStorage) +
  winston format — every request-scoped log line carries `requestId`, and
  responses echo `x-request-id`.
- **Graceful shutdown**: SIGTERM/SIGINT → drain server → close pool → exit,
  10s force deadline. Unhandled-rejection/uncaught-exception hooks.
- **`docs/runbook-production.md`**: env matrix, migrate-then-deploy
  checklist, the GA billing-flip procedure, backup/restore, webhook
  replay/drift, incident basics, Budget-time tax-table review.
- Fixed en route: `resetPassword` called a non-existent
  `userModel.updatePassword` (password reset would 500) → `updateUserPassword`.

## Legal

`/terms` + `/privacy` (shared `LegalShell`): honest GDPR-shaped templates with
`[COMPANY DETAILS]`-style placeholders the founder must fill (and have
reviewed) before GA — processors table matching the real stack (hosting, GCS,
Gmail SMTP, Stripe, Sentry), the Irish 6-year records rule, the genuine
hard-delete, "software not tax advice", read-only-on-lapse promise.
Signup gains a required consent checkbox (acceptance timestamp = account
creation). Settings carries the retention line. Landing/pricing/auth pages
link Terms/Privacy; footer notes "Essential cookies only — no tracking" (no
banner needed — there is none to consent to).

## Env flags (all default to today's open behaviour)

| Flag | Default | GA |
|---|---|---|
| `BILLING_ENFORCED` | false | **true — the launch switch** |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_SOLO` / `STRIPE_PRICE_SEAT` | unset (inert) | dashboard values |
| `REQUIRE_EMAIL_VERIFICATION` | true | true |
| `CORS_ORIGINS` | unset (permissive dev) | frontend origin |
| `SENTRY_DSN` | unset (inert) | project DSN |

## Verification

- 171 backend tests across 15 suites (57 new: entitlements, gate, checkout,
  webhooks, seat sync, validateEnv, limiter, health, verification), lint
  clean, frontend production build green.
- Migrations 010/011 round-tripped up→down→up; **from-empty bootstrap**
  proven live (see above).
- **Live E2E** (`backend/scripts/e2e-phase6.mjs`, kept in the repo): 23
  checks — practice always active with correct seat count; covered seat
  writes; canceling the practice 402s the client's writes while reads,
  tax summary and billing/status stay open; restoring the practice restores
  the seat; solo expiry/renewal; super_admin bypass; forged/missing webhook
  signatures 400; the full verification lifecycle (grace login → post-grace
  403 → resend → link redirect → verified login; wrong-kind token rejected).
  ALL PASSED. Phase 5 tax E2E (26 checks) re-run under enforced billing as
  regression: ALL PASSED. Live limiter check: 11th login attempt 429,
  `/health` unthrottled; helmet + `x-request-id` headers confirmed.

## Deliberately still out

OCR flip-on, bank feeds, Sage/ROS adapters, e-invoicing, balancing
allowances on disposal (register records date+proceeds for the accountant),
Stripe tax/VAT-invoice configuration (set in the dashboard when the entity
exists). The pilot programme (2–3 practices) needs no code.
