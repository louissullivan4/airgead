# Rename runbook: EquiLedger → rian (Phase 0, Task 0)

The **cosmetic layer** (user-facing strings, `BRAND` constant, package names) has
been done in code. This runbook lists the **identifier-layer** steps that a human
performs — Claude Code does not run these.

> Prerequisite (human): final name confirmed as **rian**, domain secured, and
> CRO/EUIPO checked.

## 1. GitHub repository rename

- Rename the repo in GitHub settings. GitHub auto-redirects old URLs, but update
  local remotes:
  ```bash
  git remote set-url origin git@github.com:<org>/rian.git
  git remote -v   # verify
  ```

## 2. Cloud Run service

- Deploy a **new** Cloud Run service under the new name (do not rename in place).
- Once healthy, update the clients to point at the new URL:
  - Frontend: `NEXT_PUBLIC_API_URL` env (and `BACKEND_URL` for server-side calls).
  - Any `mobile/servers.txt` equivalent (no mobile app exists in this repo today).
- **Verify** the new service end-to-end before deleting the old one.

## 3. npm package name (only if published)

- The package names are now `rian` / `rian-backend` / `rian-frontend`. If any were
  published to a registry, publish under the new name and deprecate the old.

## Out of scope for Phase 0 (do NOT do — document only, Task 0.3)

- **GCS bucket rename** — buckets are immutable. Phase 0 handles tenancy via an
  object-key prefix (`org_<orgId>/...`, see Task 6); a full bucket migration is
  deferred. The bucket keeps its current name.
- **Postgres database name** — left as `equiledger`. Renaming a live DB is risky
  and unnecessary for the rebrand. The lowercase name therefore still appears in
  `.env.example` / `docker-compose.yml`; this is expected and allow-listed in the
  `npm run check:brand` regression check.

## Regression check

After any further string changes, run:

```bash
cd backend && npm run check:brand
```

It fails if the legacy name appears outside: this runbook, the `BRAND_LEGACY`
constants, migration comments, the README "formerly" note, and the infra/DB-name
files listed above.
