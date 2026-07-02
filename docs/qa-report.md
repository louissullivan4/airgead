# QA validation report — 2026-07-02

Full-stack QA pass over `airgead`: every flow exercised end-to-end (unit → lint →
build → migrations → live HTTP), defects found, fixed, and re-verified. Run from
the repo `HEAD` at `b290ee8` ("Fix variant misspelling"), which was an
**incomplete** fix of the rename damage below.

## Verdict

| Gate | Before | After fix |
|---|---|---|
| Backend unit tests (jest) | ✅ 177/177 | ✅ 177/177 |
| Lint (backend eslint + frontend next lint) | ✅ clean | ✅ clean |
| **Frontend production build** | ❌ **fails** (module not found) | ✅ 22 routes, standalone |
| **`npm ci` (all CI jobs)** | ❌ **fails** (phantom package) | ✅ resolves |
| **Backend Docker image** | ❌ **fails** (`npm ci` lock out of sync) | ✅ builds (453 MB) |
| DB migrations (fresh + down/up) | ✅ (unaffected) | ✅ verified live |
| Live E2E Phase-6 (billing/webhooks/email) | — | ✅ 22/22 checks |
| Core CRUD / reports / admin / accountant | — | ✅ all 200 |
| `check:brand` guard | ❌ exit 1 | ✅ exit 0 |

Three of these were **release-blocking**: on a clean checkout, CI could not build
the frontend, could not `npm ci`, and could not build the backend image — i.e.
nothing could deploy.

---

## Defects found & fixed

### F1 — Botched `rian → airgead` rename corrupted real identifiers *(Critical, build-blocking)*
Commit `932089c "Name update to airgead"` did a blind substring replace of
`rian → airgead`. Because the English words `va**rian**ce`, `va**rian**t`,
`AlertT**rian**gle`, and `Eques**trian**` all contain "rian", it silently
mangled live code:

| Corrupted | Correct | Files |
|---|---|---|
| `class-vaairgeadce-authority` | `class-variance-authority` | badge.tsx, button.tsx, package.json |
| `VaairgeadtProps`, `badgeVaairgeadts`, `buttonVaairgeadts`, `vaairgeadts:`, `defaultVaairgeadts` | `VariantProps`, `badgeVariants`, `buttonVariants`, `variants:`, `defaultVariants` | badge.tsx, button.tsx, alert-dialog.tsx |
| `AlertTairgeadgle` | `AlertTriangle` (lucide import) | trial-banner.tsx, transaction-form-dialog.tsx |
| `Equestairgead` | `Equestrian` (UI label) | lib/org.ts |
| `vaairgeadt` | `variant` | docs/deployment-gcp.md |

**Symptom:** `next build` → `Module not found: Can't resolve 'class-vaairgeadce-authority'`.
**Fix:** reversed the collateral in the 6 affected code files (in each, *every*
`airgead` was collateral — no real brand token — so the reversal is exact) and
corrected the dependency name. Legitimate brand strings (`BRAND`,
`@airgead.dev`, `airgead_token`, service names, docs) were left untouched.
**Re-verified:** `next build` green — 22 routes compiled, standalone output.

### F2 — Rename corruption poisoned the lockfiles *(Critical, CI-blocking)*
The phantom package `class-vaairgeadce-authority` was written into
`frontend/package-lock.json` and the root `package-lock.json` (with a fake
`registry.npmjs.org/...` URL). Any clean `npm ci` — the **lint**, **test**, and
**build-frontend** CI jobs, plus the frontend Docker build — would fail trying
to fetch a package that does not exist.
**Fix:** corrected `frontend/package.json`, regenerated both lockfiles
(`npm install --package-lock-only`). Corrupt name gone; real
`class-variance-authority@0.7.1` present in both.

### F3 — `backend/package-lock.json` out of sync with `package.json` *(Critical, deploy-blocking)*
The Phase-6 hardening dependencies — `@sentry/node`, `helmet`, `stripe`,
`express-rate-limit` — are in `backend/package.json` but were **missing from the
committed lockfile** (which still pinned a stale `@types/node@14`). The backend
`Dockerfile` runs `npm ci --omit=dev`, which refuses to install when
package.json and the lockfile disagree:

```
npm error `npm ci` can only install when your package.json and package-lock.json are in sync.
npm error Missing: @sentry/node@10.63.0 from lock file
npm error Missing: helmet@8.2.0 ... stripe@22.3.0 ... express-rate-limit@8.5.2
```

**Impact:** the production backend image cannot be built at all → the GH Actions
`docker-backend` job and every deploy fail. (Local `npm test` passed only because
`node_modules` was already populated from a root workspace install.)
**Fix:** regenerated `backend/package-lock.json`.
**Re-verified:** the backend image builds (`npm ci --omit=dev` succeeds), and I
ran migrations + seed + the live backend from that exact image.

### F4 — `check:brand` guard failing on intentional references *(Low)*
`npm run check:brand` exited 1 on 6 hits that are all intentional or structural:
the checker matching **its own file** (it necessarily contains the search term),
`seed.js`'s DB_URL default using the deliberately-retained DB name `equiledger`,
and `plan.md`'s historical title.
**Fix:** extended the allow-list (checker self, `plan.md`, `seed.js`). Now exits 0.

---

## Flows validated live (evidence)

Stood up a throwaway stack in Docker (Postgres 16 + the freshly-built backend
image on a private network) and drove real HTTP + SQL.

**Migrations** — fresh bootstrap on an empty DB: `Migrations complete!`, 8 tables,
12 rows in `pgmigrations`. Reversibility: `down` 2 (011 email-verification, 010
billing) → 10 recorded → `up` → 12 recorded, with `organisations.billing_status`
and `users.email_verified_at` correctly restored.

**Phase-6 E2E** (`scripts/e2e-phase6.mjs`, billing enforced, dummy Stripe) —
**22/22 PASS**: practice always-active, 2 covered client seats, covered-seat
write allowed, cover collapses to `402 subscription_required` on write while
reads/tax-summary stay `200`, cover restores, super-admin bypass, forged/absent
webhook signature → `400`, and the full email-verification lifecycle (grace
window, 403 after grace, resend, verify-link redirect, verified login). 1
optional check skipped (needs the separate from-empty smoke org).

**Core journey smoke** — `login` → `POST /expenses` (201) → `PUT` (200) →
`GET /reports/tax-summary` (200) → `GET /admin/overview` (200, super-admin) →
`GET /accountant/clients` (200) → `DELETE /expenses/:id` (200).

The QA containers/network/image were removed after the run; reproduce with the
setup in `scripts/e2e-phase6.mjs`'s header.

---

## UI validation (real browser)

Beyond the API, the **rendered UI and button clicks** were driven in a real
Chromium via Playwright (`frontend/e2e/ui-smoke.mjs`) against the full
containerised stack. The browser ran in a Playwright container sharing the
frontend's network namespace, so it reached the app at `http://localhost:3000`
and the `Secure` httpOnly auth cookie was accepted (Chromium treats localhost as
a secure context).

**8/8 UI checks passed, 0 console/page errors:**

1. Login page renders (email, password, **Sign in**).
2. **Sign in** click → authenticates via the BFF → lands on `/home` (dashboard
   with stat cards + category chart + recent activity renders).
3. Transactions page lists the seeded rows (10 of 12 on page one).
4. Search box filters the table live.
5. **Add** → **Skip photo** opens the manual transaction form (all fields render).
6. Fill Title + Amount + category → **Add transaction** → success toast.
7. The new transaction appears in the table.
8. **Log out** → back to `/login`.

Per-step screenshots were captured. Reproduce with `frontend/e2e/README.md`.

## Hardening applied (prevents recurrence)

1. **Rename-corruption guard.** `check:brand` now runs a second scan for the
   corruption signature — a letter glued directly onto `airgead`
   (`[A-Za-z][Aa]irgead|[Aa]irgead[A-Za-z]`) — across source files. Verified it
   flags `class-vaairgeadce-authority` and ignores legit `airgead-backend`.
2. **CI now blocks on it.** Added a `brand` job to `.github/workflows/ci.yml`;
   `docker-backend`/`docker-frontend` `needs` it, so a corrupted or legacy-named
   change can't build an image or deploy. (`next build` and the `npm ci` in
   lint/test/build-frontend already gate F1–F3 — they were bypassed, not absent.)
3. **Single tracing root.** `outputFileTracingRoot` pinned in `next.config.ts`;
   the "multiple lockfiles / inferred workspace root" warning is gone.
4. **Quiet tests.** The winston logger is `silent` under `NODE_ENV==='test'`, so
   jest output is now just the results.
5. **Untracked generated artifact.** `frontend/tsconfig.tsbuildinfo` was
   committed; added `*.tsbuildinfo` to `.gitignore` and removed it from the index.

## Files changed

Rename repair: `frontend/src/components/ui/{badge,button,alert-dialog}.tsx`,
`frontend/src/components/{trial-banner,transaction-form-dialog}.tsx`,
`frontend/src/lib/org.ts`, `frontend/package.json`.
Lockfiles resynced: `package-lock.json` (root, frontend, backend).
Hardening: `backend/scripts/check-brand.js`, `.github/workflows/ci.yml`,
`frontend/next.config.ts`, `backend/src/utils/logger.js`, `.gitignore`
(+ untracked `frontend/tsconfig.tsbuildinfo`).

No product logic was altered — rename damage reverted, lockfiles resynced, and
guards/CI added so it can't recur.
