# Phase 1 — Carbon PWA Rework: status & deferred work

Phase 1 replaced the placeholder web UI with a Carbon Design app (purple theme)
structured as Home / Transactions / Settings + auth, talking to the existing
Express API through a Next.js BFF. This documents what shipped, what was
intentionally deferred, and the one backend dependency to watch.

## Shipped (this pass)

- **Deps & scaffold**: `@carbon/react`, `@carbon/charts(-react)`, `d3`, `sass`
  added to `frontend/`.
- **Auth (httpOnly cookie + BFF)**:
  - `src/app/api/auth/{login,register,logout,session}/route.ts` and the
    `src/app/api/proxy/[...path]/route.ts` catch-all. The JWT lives in the
    `rian_token` httpOnly cookie; the browser never reads it. All backend calls
    go same-origin via `/api/proxy/*`, which attaches `Authorization: Bearer`.
  - `src/middleware.ts` route guard (unauthenticated → /login; authenticated on
    an auth page → /home).
  - Phase 0 "token missing orgId" → backend 401 → proxy clears the cookie →
    client redirects to /login.
  - `src/lib/api.ts` rewritten to the **real** backend shapes (income is
    `category === 'income'`; `amount` is a string; flat login response).
- **Theme**: `src/styles/theme.scss` — Carbon purple ramp (purple-60 `#8a3ffc`).
  Global tokens via the Sass `with()` mechanism; **button component tokens pinned
  as `--cds-*` custom properties on `:root`** (they are not part of the core theme
  map and otherwise stay Carbon blue). `BRAND_PRIMARY` added to `src/lib/brand.ts`.
- **App shell**: `(app)/layout.tsx` — Carbon `Header` + `SideNav` (desktop) +
  custom bottom nav (mobile) + Support modal. `useSession()` hook in `src/lib/session.ts`.
- **Home**: stat tiles, `@carbon/charts` donut by category, recent activity,
  current-tax-year data, currency-aware formatting.
- **Transactions**: single `DataTable` with search + All/Expenses/Income filter +
  authenticated Export (ZIP blob), Add/Edit modal, OverflowMenu Edit/Delete with
  confirm, lazy signed-URL receipt thumbnails, client pagination. The add trigger
  is isolated as `onAddTransaction()` for the Phase 2 camera-first swap.
- **Settings**: profile view/edit (PATCH `/users/:id`), currency, read-only tier,
  retention placeholder, logout, and a client-management stub gated on
  `orgRole === 'owner'`.
- **Signup (both flows)** + **backend org provisioning**:
  - New backend `POST /users/register` (`userController.register` +
    `organisationModel.createUserWithOrg`). Self-serve creates a personal org and
    makes the user its owner; invite-based (token from the email link) joins the
    inviter's org as a member. This closes the Phase 0 "new user has no org → 401"
    gap. The old `/users/signup` stub is left in place but unused by the web app.
  - `(auth)/signup/page.tsx` collects the full profile and reads `?token=`.
- **Retired**: old `dashboard`/`expenses` placeholder pages; root redirects to `/home`.
- **PWA manifest**: `public/manifest.json` (name, purple `theme_color`,
  `display: standalone`) + `theme-color`/manifest meta in `layout.tsx`.

## Deferred (next pass)

- **Service worker / offline app shell / installability**: no `sw.js` yet, and the
  manifest ships with an empty `icons` array. Add maskable 192/512 icons and a
  service worker, then run a Lighthouse PWA audit. Until then the app is **not
  installable**.
- **Dark mode**: token maps are stubbed in `theme.scss`; not wired.
- **Export formats**: only the existing Excel/ZIP endpoint is wired. CSV/Sage are
  later phases.
- **Receipts "pending" tile**: Home shows total receipts; the `receipt_status='pending'`
  count arrives with Phase 2.
- **Camera-first add flow** (Phase 2): handler already isolated.
- **Amount/date column sorting** in the table uses Carbon's default comparison;
  revisit if numeric/date sort precision matters.

## Backend dependency to watch (signup)

`POST /users/register` provisions org context, so it requires the Phase 0
`organisations` table and the `users.org_id / org_role / platform_role` columns
(migration `001_organisations_and_accounts.sql`). Those migrations depend on the
production schema being captured (`db/schema.sql`) and migrations 002–004 being
run — still outstanding per `docs/phase-0-runbook.md` and `docs/schema-capture.md`.

If the org schema is **not** deployed in a given environment, `/users/register`
will error and only login works there. Verify the `organisations` table and the
new `users` columns exist before relying on signup. Login, the four screens, and
all expense flows do not depend on `/users/register`.

## Running locally

The production schema isn't captured in the repo, so local dev uses a **dev-only**
schema created by the seed script (`backend/scripts/seed.js`). One command:

```bash
npm run local          # docker compose up --build + seed demo data
```

Then open http://localhost:3000 and log in:

- **email:** `demo@rian.dev`
- **password:** `Password123!`

The demo account (a personal org owner) comes with 12 transactions across the
current year. Useful commands:

```bash
npm run seed                         # reseed (also: docker compose exec backend npm run seed)
docker compose logs -f               # tail logs
docker compose down                  # stop
docker compose down -v               # stop + wipe the database
POSTGRES_PORT=5433 docker compose up # if 5432 is already in use locally
```

Notes:
- `frontend/.npmrc` sets `legacy-peer-deps=true` so the container install accepts
  Carbon's React 18 peer range on React 19.
- **Receipt image upload** needs GCS credentials and won't work locally — create
  transactions without an image. Everything else works against the dev DB.
- Signup works locally because the dev schema includes the org columns; the seed
  script provisions them the same way `/users/register` does.

## Verification done

- `npm run build` (frontend): compiles + type-checks clean; middleware bundles.
- `npx next lint`: no warnings/errors (the "Next.js plugin not detected" notice is
  pre-existing ESLint config, unrelated to Phase 1).
- `npm test` (backend): 17/17 pass, tenant isolation intact.
- **Full Docker end-to-end** (postgres + backend + frontend, seeded):
  - Login via BFF → 200 + httpOnly `rian_token` cookie; bad password → 401.
  - `/api/auth/session` returns decoded claims (orgRole=owner).
  - Through the authenticated proxy: list (13 after a create), current-year query,
    POST create, GET profile, PATCH currency — all correct and org-scoped.
  - Unauthenticated proxy call → 401 (cookie cleared).
  - **Self-serve register** → new personal org provisioned (`orgRole=owner`); the
    new account can immediately query data (200, not 401). Duplicate email → 400.
  - Authenticated `/home`, `/transactions`, `/settings` render 200 (Carbon SSR, no
    errors); `/login`,`/signup` 307 → `/home` when already authenticated.

### Two build fixes made during local testing
- Removed the obsolete `rewrites()` in `next.config.ts`. A blanket `/api/:path*`
  rewrite runs before dynamic routes and was shadowing the `/api/proxy/[...path]`
  BFF route (forwarding to Express, bypassing the auth cookie). The BFF replaces it.
- Disabled Carbon's `@font-face` emission via `$css--font-face: false` in
  `theme.scss`. Carbon references IBM Plex through webpack's `~@ibm/plex/...` URL
  syntax, which Turbopack (`next dev`) can't resolve. IBM Plex is loaded via a
  Google Fonts `<link>` in `app/layout.tsx` instead.
