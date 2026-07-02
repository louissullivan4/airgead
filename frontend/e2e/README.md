# UI smoke test (real browser)

`ui-smoke.mjs` drives the running app in a real Chromium via **Playwright** —
it logs in, opens Transactions, filters the table, adds a transaction through
the *Add → Skip photo → form* flow, asserts the new row appears, and logs out.
It fails if any step breaks **or if the browser logs a console/page error**, and
writes a screenshot per step to `e2e/shots/`.

This is the layer above `backend/scripts/e2e-phase6.mjs` (which drives the API):
this one validates the rendered UI and button clicks.

## Run it

You need the stack up: Postgres + backend + frontend, seeded. The backend and
frontend run as containers; drive the browser from a Playwright container that
shares the frontend's network namespace, so it reaches the app at `localhost`
(Chromium treats `http://localhost` as a secure context, so the `Secure` auth
cookie is accepted).

```bash
# 1. stack (see docker-compose.yml or the commands in docs/qa-report.md)
#    frontend container = airgead-fe, seeded demo data.

# 2. drive the UI (no local install — browser + deps come from the image)
docker run --rm --network container:airgead-fe \
  -v "$PWD:/work" -w /work \
  -e BASE=http://localhost:3000 \
  mcr.microsoft.com/playwright:v1.49.1-noble \
  sh -c "npm i playwright@1.49.1 --no-audit --no-fund --silent && node e2e/ui-smoke.mjs"
```

Locally instead (needs system browser deps): `npm i -D playwright &&
npx playwright install chromium && BASE=http://localhost:3000 node e2e/ui-smoke.mjs`.

## Extend it

Add `step(page, '<name>', async () => { … })` blocks. Prefer stable selectors:
element ids (`#email`, `#tx-title`, `#tx-amount`), `getByRole`, and
`getByPlaceholder`. Every input that has a `<label>` also has a matching `id`.
