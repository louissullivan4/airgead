# Phase 6 - GA readiness: the last 20%

The product wedge (Phases 0–5) is complete: capture → accountant workspace →
Irish tax engine → export pack. What remains before general availability is the
**commercial and operational layer**: billing, hardening, a schema baseline,
legal pages, and ops. This plan is the executable list. Everything here follows
the codebase's established conventions (see "Conventions" at the bottom) and the
same discipline as the OCR seam: **built fully, enforced by config** - the app
keeps running free-and-open in dev until the GA flags are flipped.

Out of scope (deliberately, unchanged from the board summary): OCR vendor
flip-on, bank feeds, Sage/Surf/ROS adapters, e-invoicing (2028 tailwind),
balancing allowances. The pilot programme (2–3 practices) is a business track,
not code - the product already supports it.

---

## The list

| # | Item | What it is | GA-blocking because |
|---|------|-----------|---------------------|
| 1 | **Tiers + feature gating** | Trial (30 days) / Standard tiers on orgs; practice-linked client orgs are **seats covered by the practice**; gating middleware that blocks *writes* (not reads) when expired | Can't charge without a tier model; must never lock users out of their own data |
| 2 | **Stripe billing** | Checkout, customer portal, webhooks, seat-quantity sync on client invite/revoke; inert without keys | The mechanism that takes the money |
| 3 | **Pricing + billing UI** | Public `/pricing` page; Settings billing card (status, trial countdown, upgrade/manage); trial banner | Buyers need to see the price and pay unaided |
| 4 | **Security hardening** | helmet, rate limiting (strict on auth), CORS tightened to the frontend origin, boot-time env validation, `/health` | Internet-facing money-handling app baseline |
| 5 | **Email verification** | Verify-email loop for self-serve signups (invite-token signups auto-verified - they arrived by email) | Spam/abuse control + deliverability hygiene |
| 6 | **Production schema baseline** | Make `migrate:up` work on an **empty** database (baseline migration with `IF NOT EXISTS`, safe on existing prod); seed becomes demo-data-only | Today the schema's only source of truth is the dev seed script - unacceptable for prod |
| 7 | **Ops: errors, shutdown, runbook** | Sentry behind `SENTRY_DSN` (inert without), graceful SIGTERM shutdown, request IDs in logs, production runbook (deploy/backup/restore checklist) | Can't run what you can't observe or recover |
| 8 | **Legal pages + consent** | `/terms`, `/privacy` (GDPR-appropriate, placeholders for company details), signup consent checkbox, essential-cookies notice, retention line in Settings | Legally required before real customers |

Sequenced as five PRs below. Estimated 5–8 solo weeks by hand; each PR is
independently shippable and leaves `main` green.

---

## PR 1 - Tiers & gating (enforcement OFF by default)

**Migration `010_billing.sql`** (additive, reversible, guarded - style of 009):
- `organisations`: `trial_ends_at timestamptz`, `stripe_customer_id text`,
  `stripe_subscription_id text`, `billing_status text NOT NULL DEFAULT 'none'`
  with guarded CHECK in `('none','trialing','active','past_due','canceled')`.
  Guarded CHECK on existing `subscription_level` in `('trial','standard')`
  after `UPDATE organisations SET subscription_level='trial' WHERE
  subscription_level IS NULL` (existing orgs start as trialing at flip time).
  Index `idx_organisations_stripe_customer` on `stripe_customer_id`.
- Backfill `trial_ends_at = now() + interval '30 days'` where null.
- Mirror everything into `backend/scripts/seed.js` `SCHEMA_SQL` (demo orgs:
  `subscription_level='standard'`, `billing_status='active'` so the demo never
  shows warnings).

**`backend/src/config/tiers.js`** - single source of truth:
```js
TRIAL_DAYS = 30
TIERS = { trial: {...}, standard: {...} }   // labels + copy, no prices here
BILLING_ENFORCED = process.env.BILLING_ENFORCED === 'true'   // default OFF
```

**`backend/src/services/billing/entitlements.js`**:
- `getEffectiveSubscription(pool, orgId)` →
  `{ tier, status, trialEndsAt, coveredByPracticeOrgId|null, active: boolean }`.
  Resolution order: (a) org has `billing_status='active'` → active standard;
  (b) org is a client with an **active** `accountant_org_links` row whose
  practice org has `billing_status='active'` → covered seat (active);
  (c) trialing and `trial_ends_at > now()` → active trial; (d) otherwise
  expired. super_admin orgs and practice orgs themselves are always active
  (the practice is free - the seats pay; enforce seat payment on the CLIENT
  org's entitlement via (b)).
- Keep it one SQL round-trip where possible (org row + one links/practice join).

**`backend/src/middlewares/billing.js`**:
- `requireActiveSubscription` - when `BILLING_ENFORCED` false → `next()`.
  When true: resolve entitlement; inactive → `402 { error, code:'subscription_required' }`.
  **Apply to write routes only**: POST/PATCH/PUT/DELETE on `/expenses`,
  `/receipts`, `/assets`. Reads, exports, login, settings, billing routes stay
  open - users must always be able to see data and pay. super_admin bypasses.
- `GET /billing/status` (new `billingRoutes.js`, `injectPool` +
  `authenticateToken, scopeToOrg`) returns the entitlement for the caller's
  org - the frontend banner reads this.

**Tests (`backend/test/billing.test.js`, Jest + sinon, mocked pool)**:
enforcement off = everything passes; expired trial blocks a write with 402 but
not a read; covered-seat client passes when the practice is active and fails
when the link is revoked; practice org itself always active; super_admin
bypass; trial-window math around `trial_ends_at`.

## PR 2 - Stripe (checkout, portal, webhooks; inert without keys)

Add `stripe` to backend deps. **`backend/src/services/billing/stripeClient.js`**
returns `null` when `STRIPE_SECRET_KEY` unset (OCR-seam discipline; all routes
502 with "billing not configured" when null).

Env (document in `.env.example`): `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_SOLO` (standard, per org/month),
`STRIPE_PRICE_SEAT` (per client seat/month, practice pays), `BILLING_ENFORCED`.

**Routes (`/billing/*`)**:
- `POST /billing/checkout-session` (owner-only via `requireOrgRole('owner')`):
  solo org → subscription checkout with `STRIPE_PRICE_SOLO`, qty 1; practice
  org → `STRIPE_PRICE_SEAT` with `quantity = count(active links)` (min 1).
  Creates/reuses `stripe_customer_id` (store on org). `success_url`/`cancel_url`
  → `${FRONTEND_URL}/settings?billing=success|canceled`.
- `POST /billing/portal-session` (owner-only) → Stripe customer portal URL.
- `POST /billing/webhook` - **mount with `express.raw({type:'application/json'})`
  BEFORE the global `bodyParser.json` in `src/index.js`** (signature
  verification needs the raw body). Verify via `STRIPE_WEBHOOK_SECRET`. Handle:
  `checkout.session.completed` (attach ids, `billing_status='active'`,
  `subscription_level='standard'`), `customer.subscription.updated`
  (map Stripe status → billing_status; update `renewal_date`),
  `customer.subscription.deleted` (`canceled`). Look orgs up by
  `stripe_customer_id`. Always 200 fast; log + swallow per-event errors.
- **Seat sync** `backend/src/services/billing/seatSync.js`:
  `syncPracticeSeats(pool, practiceOrgId)` - count active links, update the
  Stripe subscription item quantity (proration default). Call best-effort
  (log, never fail the request) after client-invite signup
  (`createUserWithOrg` client path - call from `userController.register`
  after commit, not inside the transaction) and after revoke
  (`accountantController.revokeClient`). No-op when stripe client null or
  practice has no subscription id.

**Frontend**:
- `api.billing`: `status()`, `checkout()`, `portal()` in `lib/api.ts`
  (+ `BillingStatus` type).
- Settings billing card (owner-only, above the danger zone): tier + status
  badge, trial countdown, seat count for practices, primary button →
  checkout redirect (or portal when subscribed). Handle
  `?billing=success|canceled` toasts.
- `components/trial-banner.tsx` rendered from the app layout: reads
  `api.billing.status()`; shows nothing when active/covered or enforcement
  off (backend returns `enforced:false`); amber countdown ≤7 days; red
  "read-only until you subscribe" when expired, linking to Settings.
- Public **`/pricing`** page (marketing tone, honest): Solo Standard and
  Practice per-seat cards, prices from `frontend/src/lib/pricing.ts`
  (display-only constants: solo €9/mo, seat €7/mo - placeholders the founder
  aligns with the Stripe dashboard), FAQ line that the accountant pays
  nothing. Link from the landing page header/footer.

**Tests**: webhook signature rejection (bad sig → 400) and event handling
(stub stripe client + model); checkout route builds the right price/quantity
per org kind; seat sync counts active links only; all routes 502-clean when
stripe unconfigured.

## PR 3 - Security hardening + email verification

- Deps: `helmet`, `express-rate-limit`.
- `src/index.js`: `app.use(helmet())` (defaults; CSP not needed for a JSON
  API); global limiter 300 req/15 min/IP; strict limiter (10/15 min) on
  `POST /users/login`, `POST /users/register`,
  `POST /users/request-password-reset`. Skip entirely when
  `NODE_ENV === 'test'` (keeps the mocked suites deterministic).
- CORS: `CORS_ORIGINS` env (comma list). Set → `cors({ origin: list })`;
  unset → current permissive behaviour (dev). Document that prod sets it to
  the frontend URL.
- **`backend/src/config/validateEnv.js`** run at boot from `server.js`: in
  production fail fast when `JWT_SECRET` missing/short (<32 chars), `DB_URL`
  missing, `FRONTEND_URL` missing; warn (not fail) on missing SMTP/Stripe.
- `GET /health` in `index.js`: `SELECT 1` through the pool → 200/503 (no auth).
- **Email verification** - migration `011_email_verification.sql`:
  `users.email_verified_at timestamptz` (nullable). Rules: any signup that
  came through a signed invite token (member/client/platform) is verified at
  creation (`now()`) - they arrived by email. Self-serve signups get a signed
  JWT `{ email, kind:'verify' }` (24 h) mailed via the existing nodemailer
  transport (reuse the `sendInviteEmail` pattern);
  `GET /users/verify-email?token=` sets the timestamp and redirects to
  `${FRONTEND_URL}/login?verified=1`. Login: unverified + older than a 7-day
  grace window → 403 with `code:'email_unverified'`;
  `POST /users/resend-verification` (rate-limited) re-sends. Gate the whole
  check behind `REQUIRE_EMAIL_VERIFICATION` (default **true**; tests/dev can
  disable). Frontend: banner in the app layout during grace, login-page
  error handling + resend link, `verified=1` toast.

**Tests**: strict limiter trips on the 11th login attempt (enable limiter in
that suite explicitly); invited signup auto-verified vs self-serve not;
expired-grace login 403 + resend flow; env validation failures; `/health`
degrades to 503 when the pool query rejects.

## PR 4 - Schema baseline + ops

- **Baseline**: inspect `migrations/000_baseline.sql` (currently assumes a
  pre-existing prod schema - running from empty fails at 001 with
  `relation "users" does not exist`). Rewrite `000_baseline.sql` to create the
  pre-Phase-0 core (`users`, `expenses`, `user_invites`) with
  `IF NOT EXISTS` + guarded constraints so it **no-ops on existing prod**
  (its pgmigrations row already exists there) and bootstraps a fresh DB.
  Acceptance: fresh throwaway Postgres → `npm run migrate:up` alone → server
  boots → login/expense smoke passes. Seed keeps `SCHEMA_SQL` as a dev
  convenience but its header now points to migrations as the source of truth.
- **Sentry**: `@sentry/node` initialised only when `SENTRY_DSN` set;
  request + error handler wired in `index.js`; unhandled-rejection hook in
  `server.js`.
- **Request IDs**: tiny middleware - accept `x-request-id` or generate uuid,
  set on `res`, include in the winston log format.
- **Graceful shutdown**: `server.js` SIGTERM/SIGINT → `server.close()` +
  `pool.end()` with a 10 s force-exit.
- **`docs/runbook-production.md`**: env matrix (every flag in this plan +
  existing ones), deploy checklist (migrate → deploy → health check),
  backup/restore (managed-Postgres PITR + manual `pg_dump` command), webhook
  replay note, incident basics (suspend org/user via admin, key rotation).

## PR 5 - Legal & GA polish

- Frontend static pages `(marketing)` group or plain routes: **`/terms`** and
  **`/privacy`** - honest GDPR-appropriate templates (controller identity,
  what's stored incl. receipt images, processors table: hosting/SMTP/Stripe,
  retention: Irish 6-year tax-records rule, GDPR rights incl. the existing
  hard-delete, cookies: essential session only) with clearly marked
  `[COMPANY DETAILS]` placeholders the founder must fill. Linked from the
  landing footer, `/pricing`, and both auth pages.
- Signup: required consent checkbox - "I agree to the Terms of Service and
  Privacy Policy" (links open in new tab); block submit without it; pass
  nothing to the backend (consent timestamp = account creation, noted in
  privacy page).
- Settings: one retention line - "Records are kept while your account is
  active; Irish Revenue requires keeping tax records for 6 years."
- Landing: pricing link; one-line cookies notice in the footer ("Essential
  cookies only - no tracking."). No consent banner needed (essential-only).

---

## Env flags introduced (all default to today's open behaviour)

| Flag | Default | Flip for GA |
|---|---|---|
| `BILLING_ENFORCED` | `false` | `true` |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_SOLO` / `STRIPE_PRICE_SEAT` | unset | Stripe dashboard values |
| `REQUIRE_EMAIL_VERIFICATION` | `true` (skippable in dev/test) | `true` |
| `CORS_ORIGINS` | unset (permissive) | frontend origin |
| `SENTRY_DSN` | unset (inert) | project DSN |

## Verification (every PR)

- `cd backend && npm test` and `npm run lint` green; `cd frontend && npm run build` green.
- Migration round-trip on a throwaway Postgres (docker `postgres:16-alpine`,
  port 55432): PR 1/3 migrations up→down→up; PR 4 additionally **from-empty**
  `migrate:up` → boot → smoke.
- Live E2E drive (the Phase-5 pattern: seed → boot on :58080 → node fetch
  script): trial expiry blocks a write with 402 but not a read; covered seat
  passes; webhook with a bad signature 400s; unverified self-serve login 403s
  after grace while an invited client logs straight in; `/health` 200.

## Conventions (for the implementer)

Migrations: SQL files, `-- Up Migration` / `-- Down Migration`, `IF NOT
EXISTS`, guarded `DO $$ pg_constraint $$` blocks; next numbers are **010, 011**;
mirror schema into `scripts/seed.js`. Tenant scoping: `orgPredicate` user→org
subquery, `scopeOrgIdFor(req)`, super_admin = null orgId. Routes:
`injectPool` → `authenticateToken, scopeToOrg` (+ `requireOrgRole('owner')`
where noted), registered in `src/index.js`. Tests: Jest + sinon, fully mocked
pool/models - no live DB. Frontend: all calls through `lib/api.ts` →
`/api/proxy/*`; shadcn/Radix/Tailwind; nav gating via props from
`app/(app)/layout.tsx`. Dev commands run inside WSL:
`wsl -d Ubuntu -e bash -lc 'cd /home/stew/code/rian/... && …'`.
