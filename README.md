<div align="center">

# airgead

**Turn receipts into tax-ready records.**

Expense & receipt tracking with a built-in Irish tax engine — for freelancers,
sole traders, and the accountants who serve them.

![Next.js](https://img.shields.io/badge/Next.js-15-000000?logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Node.js](https://img.shields.io/badge/Node.js-20-339933?logo=nodedotjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)

</div>

---

## Features

- 📸 **Receipt capture** — snap a photo; it's stored and attached to the expense.
- 🗂️ **Auto-categorization** — every expense lands in the right category.
- 🇮🇪 **Irish tax engine** — capital allowances (wear & tear), VAT, and a Form 11 pre-sort.
- 📊 **Tax summary & reports** — the full year's picture per business, in one view.
- 📦 **Tax-year exports** — Excel, CSV, and a receipt-archive ZIP in a click.
- 👥 **Accountant workspace** — practices manage every client's books; invited clients are free.
- 💳 **Billing** — 14-day free trial, then Stripe subscriptions (solo or per client seat).
- 🔗 **Sage export** — push client transactions to Sage Business Cloud (optional).
- 🔒 **Multi-tenant** — per-organisation isolation, owner/member roles, and a super-admin surface.
- 📱 **Installable PWA** — works offline-aware on mobile.

## Tech stack

| Layer | Tech |
|-------|------|
| **Frontend** | Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Radix UI · Serwist (PWA) |
| **Backend** | Node 20 · Express · PostgreSQL 16 · node-pg-migrate · JWT · Stripe · Jest |
| **Storage / ops** | Local disk or Google Cloud Storage · Sentry (optional) |
| **Infra** | Docker Compose · GitHub Actions → GHCR → Railway |

## Quick start

**Prerequisites:** [Docker](https://docs.docker.com/get-docker/) & Docker Compose. (Node 20+ only if you run outside Docker.)

```bash
git clone <this-repo> airgead && cd airgead

# Create the env files (defaults work out of the box for local dev)
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local

# Build, start, migrate, and seed the whole stack in one go
npm run local
```

That's it. When it finishes you'll have:

| Service | URL |
|---------|-----|
| Web app | http://localhost:3000 |
| API | http://localhost:8080 |
| PostgreSQL | localhost:5432 |

**Demo login** (created by the seed): `demo@airgead.dev` / `Password123!`

> The first web page load compiles on demand — give it a few seconds.

## Development

`npm run local` is the fast path. If you'd rather drive the pieces yourself:

```bash
npm run dev            # docker compose up (Postgres + API + web)
npm run dev:backend    # backend only  (nodemon)
npm run dev:frontend   # frontend only (next dev)

# Inside the running stack:
npm run migrate:up --workspace=backend   # apply DB migrations
npm run seed                              # (re)seed demo data
```

Stop with `docker compose down`, or `docker compose down -v` to also wipe the database.

## Configuration

Everything is driven by env files, each documented inline:
[`backend/.env.example`](backend/.env.example) and
[`frontend/.env.local.example`](frontend/.env.local.example). The defaults run a
full local stack with no external accounts. The essentials:

| Variable | Purpose |
|----------|---------|
| `DB_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Token signing key (≥ 32 chars in production) |
| `FRONTEND_URL` | Base URL for email links & Stripe redirects |
| `BILLING_ENFORCED` | `true` enforces subscriptions; `false` = everything free (demo mode) |
| `STRIPE_*` | Stripe keys + recurring price ids (billing is inert while unset) |
| `SAGE_ENABLED` / `SAGE_*` | Sage Business Cloud export (off while unset) |
| `STORAGE_DRIVER` | `local` disk or `gcs` for receipt images |
| `SMTP_*` | Transactional email (invites, verification, resets) |

## Project structure

```
airgead/
├── backend/     Express + PostgreSQL API (routes, migrations, Jest tests)
├── frontend/    Next.js web app (App Router, PWA)
├── docs/        Design notes, runbooks, and QA reports
├── scripts/     Dev helpers (dev.sh → `npm run local`)
└── docker-compose.yml
```

## API overview

The backend mounts these route groups (all JSON; most require a Bearer JWT):

| Prefix | What it handles |
|--------|-----------------|
| `/users` | Register, login, profile, password reset, email verification |
| `/expenses` | Income & expense line items |
| `/receipts` | Capture, store, and split receipts into line items |
| `/assets` | Capital-asset register (wear & tear over 8 years) |
| `/reports` | Tax summary — Form 11, VAT, capital allowances |
| `/organisations` | Org profile, categories, members, invites |
| `/accountant` | Practice → client workspaces and exports |
| `/billing` | Plans, Stripe checkout/portal, webhook |
| `/sage` | Sage Business Cloud export (feature-flagged) |
| `/admin` | Platform super-admin |
| `/files`, `/health` | Signed image URLs and the health probe |

See [`backend/src/routes/`](backend/src/routes/) for the full route definitions.

## Testing

```bash
npm test          # backend Jest suite
npm run lint      # lint both workspaces
```

## Deployment

On every push to `main`, [GitHub Actions](.github/workflows/ci.yml) lints, tests,
and builds the Docker images to GHCR, runs database migrations, then redeploys the
backend and frontend on Railway. See [`docs/runbook-production.md`](docs/runbook-production.md).

## License

Private project — all rights reserved.
