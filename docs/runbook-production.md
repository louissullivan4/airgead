# Production runbook

Operational reference for running airgead in production: environment matrix,
deploy checklist, backup/restore, billing webhooks, and incident basics.
Written for the founder-operator; assumes managed Postgres + a container host
(Cloud Run / Railway / Fly) + the Next.js frontend on its own host.

## Environment matrix

Backend (`backend/.env` / host env). Full annotated list in
`backend/.env.example`.

| Variable | Required in prod | Default behaviour when unset |
|---|---|---|
| `NODE_ENV` | yes (`production`) | env validation only warns instead of failing |
| `PORT` | host-provided | 3000 |
| `DB_URL` | **yes - boot fails without it** | - |
| `JWT_SECRET` | **yes, ≥32 chars - boot fails** | - |
| `FRONTEND_URL` | **yes - boot fails** (email links, Stripe redirects) | - |
| `PUBLIC_BACKEND_URL` | yes (signed file URLs, verification links) | `http://localhost:8080` |
| `CORS_ORIGINS` | strongly recommended (comma list = frontend origin) | permissive CORS + boot warning |
| `EMAIL_USERNAME` / `EMAIL_PASSWORD` | yes (invites, resets, verification) | mail sends fail, logged; signups still succeed |
| `REQUIRE_EMAIL_VERIFICATION` | leave default (`true`) | `false` disables the login gate |
| `BILLING_ENFORCED` | **the GA switch** - `false` until launch day | free-and-open; expired orgs never blocked |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | yes once billing is on | billing routes answer 502; seat sync no-ops |
| `STRIPE_PRICE_SOLO` / `STRIPE_PRICE_SEAT` | yes once billing is on | checkout answers 502 |
| `SENTRY_DSN` | recommended | Sentry never loaded |
| `STORAGE_DRIVER` + GCS vars | `gcs` + bucket creds | `local` disk (fine for a single instance only) |
| `OCR_PROVIDER` / `OCR_AUTOFILL_ENABLED` | leave `none` / `false` | dormant OCR seam stays off |

Frontend: `BACKEND_URL` (server-side proxy target), `NEXT_PUBLIC_*` flags per
`frontend/.env.example`.

## Deploy checklist

Order matters: **migrate, then deploy**. Migrations are additive and
backwards-compatible with the previous app version.

1. `git tag` the release; confirm CI is green (lint, backend tests, frontend
   build, backend image).
2. Take/confirm a database snapshot (managed PITR usually suffices - see
   Backups).
3. Run migrations against prod: `cd backend && DB_URL=<prod> npm run
   migrate:up`. Output ends `Migrations complete!`.
4. Deploy the backend image; then the frontend.
5. Verify:
   - `GET /health` → `{"status":"ok"}` (also proves DB connectivity);
   - log in as a real account, add + delete a test expense;
   - `GET /billing/status` shows the expected `enforced` flag;
   - logs show `x-request-id` values and no error burst; Sentry quiet.
6. Rollback = redeploy the previous image. Migrations are designed not to
   need a `migrate:down` for app rollback (additive, `IF NOT EXISTS`); only
   roll the schema back with a restored snapshot in a real emergency.

### First-ever bootstrap (fresh database)

`npm run migrate:up` on the empty database creates everything (000 baseline →
011). No seed required. `npm run seed` is for demo data in dev only - never
run it in prod.

### GA / billing flip (the launch-day change)

1. In Stripe: create the two recurring monthly prices; note ids →
   `STRIPE_PRICE_SOLO`, `STRIPE_PRICE_SEAT`.
2. Add a webhook endpoint `https://<backend>/billing/webhook` for events
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`; copy the
   signing secret → `STRIPE_WEBHOOK_SECRET`.
3. Set `STRIPE_SECRET_KEY`, the price ids, the webhook secret. Deploy. Test a
   checkout end-to-end with a Stripe test card while `BILLING_ENFORCED` is
   still false.
4. Set `BILLING_ENFORCED=true`. From that moment expired orgs get 402 on
   writes (reads/exports/billing always stay open). Existing orgs were
   backfilled with 30-day trials by migration 010 **at migration time** -
   check `select count(*) from organisations where trial_ends_at < now()`
   before flipping so you know who expires immediately.

## Backups & restore

- **Primary**: the managed-Postgres provider's point-in-time recovery.
  Confirm it is enabled and retention ≥ 7 days.
- **Belt and braces** (before risky changes, or scheduled):
  `pg_dump --format=custom --no-owner "$DB_URL" > airgead-$(date +%F).dump`
- **Restore** to a NEW database, verify, then repoint `DB_URL`:
  `pg_restore --no-owner --dbname "$NEW_DB_URL" airgead-YYYY-MM-DD.dump`
- Receipt images live in GCS (or local disk in dev), not the DB - GCS
  versioning/soft-delete is the image backup story. A DB restore does not
  touch images; orphaned image paths are harmless.

## Stripe webhook operations

- The endpoint verifies signatures with the raw body; a bad signature is 400.
  Handler errors are logged and answered 200 (Stripe should not retry a
  poison event); state converges on the next subscription event.
- **Replay**: Stripe dashboard → Developers → Events → resend to the
  endpoint. Safe: handlers are idempotent (they upsert billing state by org).
- **Drift check** (org thinks it's active, Stripe disagrees): compare
  `organisations.billing_status`/`stripe_subscription_id` with the dashboard;
  resend the latest `customer.subscription.updated` event to reconverge.
- Seat counts: practice quantity syncs on client invite/revoke. If a sync was
  missed (Stripe outage), it self-heals on the next invite/revoke, or update
  the subscription item quantity by hand in the dashboard to match
  `select count(*) from accountant_org_links where accountant_org_id = $1
  and status = 'active'`.

## Incident basics

- **Abusive/compromised account**: super-admin dashboard → suspend user (or
  the whole org). Suspension blocks login immediately; reactivation restores.
- **GDPR erasure**: super-admin → delete user/org - hard-deletes rows AND
  stored receipt images. Irreversible; confirm identity first.
- **JWT secret rotation** (suspected leak): set a new `JWT_SECRET`, deploy.
  Every session (and pending verification/invite links) is invalidated -
  users just log in again; pending invites must be re-sent.
- **Stripe key rotation**: roll in the Stripe dashboard, update env, deploy.
  Webhook secret rotates independently (dashboard → endpoint → roll secret).
- **Database down**: `/health` answers 503 (load balancers stop routing).
  The app fails open on billing checks and fails closed on data reads -
  nothing corrupts; restore DB connectivity and it recovers without restart
  (pool reconnects).
- **Reading logs**: every request-scoped line carries `requestId` - get the
  `x-request-id` from the failing response (the frontend proxy passes it
  through) and grep for it.

## Scheduled cares

- Each Irish Budget (October): review the flat-rate addition table in
  `backend/src/services/tax/vat.js` and the €24k car cap in
  `wearAndTear.js`; add the new year's rate.
- Quarterly: restore-test a backup into a scratch database; rotate the SMTP
  app password; `npm audit` both packages.
- Before each tax season (Oct–Nov): expect the accountant-export peak; check
  disk/instance sizing.
