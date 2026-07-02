# Production deployment on Google Cloud — airgead

End-to-end guide to running **airgead** in production on Google Cloud, with
automatic zero-touch releases from GitHub Actions. Written to match the app
*as it is built today* — Express backend (`:8080`), Next.js standalone frontend
(`:3000`), PostgreSQL, GCS receipt storage, Stripe billing, Gmail SMTP email,
Sentry, and the dormant OCR seam.

> Today's CI (`.github/workflows/ci.yml`) builds images to GHCR and redeploys on
> **Railway**. This document replaces the deploy half with a GCP-native pipeline
> (Artifact Registry → Cloud Run) and keeps the CI half (lint/test/build) intact.
> Nothing here requires application code changes — every integration is already
> wired through environment variables.

---

## 1. Target architecture

| Concern | airgead today | GCP service |
|---|---|---|
| Backend API (Express, `:8080`) | container | **Cloud Run** service `airgead-backend` |
| Frontend (Next.js standalone, `:3000`) | container | **Cloud Run** service `airgead-frontend` |
| Database | PostgreSQL 16 | **Cloud SQL for PostgreSQL 16** |
| Receipt images | `STORAGE_DRIVER=gcs`, private + V4 signed URLs | **Cloud Storage** bucket |
| Secrets (JWT, DB pass, Stripe, SMTP…) | env vars | **Secret Manager** |
| Container images | GHCR | **Artifact Registry** |
| DB migrations | `npm run migrate:up` | **Cloud Run Job** `airgead-migrate` |
| CI/CD identity | Railway hooks | **Workload Identity Federation** (keyless) |
| Payments | Stripe (`/billing/webhook`) | Stripe → Cloud Run backend |
| Transactional email | Gmail SMTP (nodemailer) | external SMTP relay |
| Error tracking | `SENTRY_DSN` | Sentry (SaaS) |
| TLS / custom domain / WAF | — | **Global External HTTPS LB + Cloud Armor** |
| Logs / metrics / alerts | winston + request IDs | **Cloud Logging / Monitoring** |

```
                          ┌────────────────────────────────────────────┐
   Browser ──HTTPS──▶ Global External HTTPS Load Balancer + Cloud Armor │
                          │   app.example.com          api.example.com  │
                          └──────┬──────────────────────────┬───────────┘
                                 ▼ (serverless NEG)          ▼ (serverless NEG)
                        Cloud Run: airgead-frontend    Cloud Run: airgead-backend
                                 │  BACKEND_URL ───────────▶ │
                                 │                           ├─▶ Cloud SQL (Postgres 16)  [unix socket]
                                 │                           ├─▶ Cloud Storage (receipts, signed URLs)
                                 │                           ├─▶ Secret Manager (JWT/DB/Stripe/SMTP)
                                 │                           ├─▶ Stripe API + webhook
                                 │                           └─▶ Gmail SMTP (email)
   Stripe ──webhook──▶ api.example.com/billing/webhook ──────┘
```

**Region:** pick one and use it everywhere. For an Irish product use
`europe-west1` (Belgium) or `europe-west2` (London) to keep receipt image /
personal data in-EU (GDPR). This guide uses `europe-west1`.

---

## 2. Prerequisites

- A Google Cloud account with a **billing account** you can attach.
- `gcloud` CLI installed and logged in: `gcloud auth login`.
- Owner (or Project Creator + billing) on the org, for the one-time setup.
- A registered **domain** you can edit DNS for.
- A **Stripe** account (test + live keys) and a **Gmail/Workspace** account with
  an App Password for SMTP (or another SMTP relay — see §9.4).
- The GitHub repo for airgead (referred to below as `OWNER/REPO`).

Everything below is copy-paste. Set these shell variables once and reuse them:

```bash
# ── Edit these ───────────────────────────────────────────────────────────────
export PROJECT_ID="airgead-prod"                 # globally-unique GCP project id
export REGION="europe-west1"
export DOMAIN="example.com"                    # your apex domain
export GITHUB_REPO="OWNER/REPO"                # e.g. louis/airgead
export BILLING_ACCOUNT="XXXXXX-XXXXXX-XXXXXX"  # gcloud billing accounts list
export DB_TIER="db-custom-1-3840"              # 1 vCPU / 3.75GB; size to load
# ── Derived (leave as-is) ────────────────────────────────────────────────────
export SQL_INSTANCE="airgead-pg"
export DB_NAME="airgead"
export DB_APP_USER="airgead_app"
export AR_REPO="airgead"
export BUCKET="${PROJECT_ID}-receipts"
export RUN_SA="airgead-run@${PROJECT_ID}.iam.gserviceaccount.com"
export DEPLOY_SA="airgead-deployer@${PROJECT_ID}.iam.gserviceaccount.com"
export SQL_CONN="${PROJECT_ID}:${REGION}:${SQL_INSTANCE}"
export IMAGE_BACKEND="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/backend"
export IMAGE_FRONTEND="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/frontend"
```

---

## PART A — One-time GCP foundation

Run this section once. It is idempotent enough to re-run safely.

### A1. Project, billing, APIs

```bash
gcloud projects create "$PROJECT_ID" --name="airgead production"
gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT"
gcloud config set project "$PROJECT_ID"

gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  sqladmin.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  cloudbuild.googleapis.com \
  compute.googleapis.com \
  logging.googleapis.com \
  monitoring.googleapis.com
```

### A2. Artifact Registry (container images)

```bash
gcloud artifacts repositories create "$AR_REPO" \
  --repository-format=docker --location="$REGION" \
  --description="airgead container images"
```

### A3. Cloud SQL — PostgreSQL 16

```bash
# Instance (private-ish: no public IP; reached via the Cloud SQL connector).
gcloud sql instances create "$SQL_INSTANCE" \
  --database-version=POSTGRES_16 \
  --tier="$DB_TIER" \
  --region="$REGION" \
  --storage-auto-increase \
  --availability-type=REGIONAL \        # HA failover (drop to ZONAL to save cost)
  --backup-start-time=02:00 \
  --enable-point-in-time-recovery \
  --retained-backups-count=14 \
  --no-assign-ip

# App database + least-privilege app user.
gcloud sql databases create "$DB_NAME" --instance="$SQL_INSTANCE"
DB_APP_PASSWORD="$(openssl rand -base64 32)"
gcloud sql users create "$DB_APP_USER" \
  --instance="$SQL_INSTANCE" --password="$DB_APP_PASSWORD"
echo "Save this app DB password into Secret Manager in step A5:"; echo "$DB_APP_PASSWORD"
```

> **Connection string.** The app (`src/utils/db.js`) and migrations both read
> `DB_URL`. On Cloud Run we attach the instance and connect over its Unix
> socket — no proxy sidecar, no public IP:
>
> ```
> DB_URL=postgresql://airgead_app:<PASSWORD>@/airgead?host=/cloudsql/<PROJECT>:<REGION>:airgead-pg
> ```
>
> `pg` understands the `?host=/cloudsql/...` socket directory form, so this
> works with **no code change**.

### A4. Cloud Storage — receipt bucket

Private bucket, uniform IAM, versioning on (image backup story), and the tiered
lifecycle from `plan.md` Phase 3 keyed off the `org_{id}/{year}/` prefix.

```bash
gcloud storage buckets create "gs://${BUCKET}" \
  --location="$REGION" \
  --uniform-bucket-level-access \
  --public-access-prevention

# Versioning = soft-delete / image backup.
gcloud storage buckets update "gs://${BUCKET}" --versioning

# Lifecycle: Standard → Nearline(90d) → Coldline(365d) → Archive(730d).
cat > /tmp/lifecycle.json <<'JSON'
{ "rule": [
  { "action": {"type":"SetStorageClass","storageClass":"NEARLINE"}, "condition": {"age":90}},
  { "action": {"type":"SetStorageClass","storageClass":"COLDLINE"}, "condition": {"age":365}},
  { "action": {"type":"SetStorageClass","storageClass":"ARCHIVE"},  "condition": {"age":730}}
]}
JSON
gcloud storage buckets update "gs://${BUCKET}" --lifecycle-file=/tmp/lifecycle.json
```

> Objects stay **private**; the API serves them via short-TTL **V4 signed URLs**
> (`backend/src/utils/gcs.js`). Signed URLs from Cloud Run need a signing
> permission — handled in A6.

### A5. Secret Manager — all secrets

Create one secret per sensitive value. Cloud Run reads them at deploy time.

```bash
mksecret () { printf '%s' "$2" | gcloud secrets create "$1" --data-file=- 2>/dev/null \
  || printf '%s' "$2" | gcloud secrets versions add "$1" --data-file=-; }

# Core
mksecret jwt-secret            "$(openssl rand -hex 48)"          # ≥32 chars (boot-fatal if weak)
mksecret db-url                "postgresql://${DB_APP_USER}:${DB_APP_PASSWORD}@/${DB_NAME}?host=/cloudsql/${SQL_CONN}"
# Stripe (fill with your live keys; see §9.3)
mksecret stripe-secret-key     "sk_live_xxx"
mksecret stripe-webhook-secret "whsec_xxx"
mksecret stripe-price-solo     "price_xxx"
mksecret stripe-price-seat     "price_xxx"
# Email (Gmail App Password; see §9.4)
mksecret email-username        "noreply@${DOMAIN}"
mksecret email-password        "your-16char-app-password"
# Observability
mksecret sentry-dsn            "https://xxx@xxx.ingest.sentry.io/xxx"
```

> Non-secret config (`GOOGLE_CLOUD_STORAGE_BUCKET`, `CORS_ORIGINS`,
> `FRONTEND_URL`, `BILLING_ENFORCED`, …) goes in as plain env vars at deploy
> time (Part B / D), **not** in Secret Manager.

### A6. Service accounts & IAM

Two identities: a **runtime** SA the containers run as, and a **deployer** SA
GitHub Actions impersonates.

```bash
# Runtime SA (what airgead-backend / airgead-frontend / airgead-migrate execute as)
gcloud iam service-accounts create airgead-run --display-name="airgead runtime"
# Deployer SA (assumed by GitHub Actions via WIF)
gcloud iam service-accounts create airgead-deployer --display-name="airgead CI/CD deployer"

# ── Runtime SA grants ──
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${RUN_SA}" --role="roles/cloudsql.client"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${RUN_SA}" --role="roles/secretmanager.secretAccessor"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${RUN_SA}" --role="roles/logging.logWriter"
# Bucket read/write/delete (GDPR hard-delete needs delete).
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${RUN_SA}" --role="roles/storage.objectAdmin"
# CRITICAL: V4 signed URLs from Cloud Run (no local key → IAM SignBlob API).
# The SA must be able to sign as ITSELF, or getSignedUrl() throws.
gcloud iam service-accounts add-iam-policy-binding "$RUN_SA" \
  --member="serviceAccount:${RUN_SA}" --role="roles/iam.serviceAccountTokenCreator"

# ── Deployer SA grants ──
for ROLE in roles/run.admin roles/artifactregistry.writer \
            roles/iam.serviceAccountUser roles/cloudsql.client; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${DEPLOY_SA}" --role="$ROLE"
done
```

> `roles/iam.serviceAccountUser` lets the deployer deploy services that *run as*
> `airgead-run`. Signed URLs work because the storage client, finding no private
> key on Cloud Run, calls the IAM `signBlob` API — which the
> `serviceAccountTokenCreator` self-binding authorises. This is the single most
> common "signed URLs 500 in prod" gotcha; do not skip it.

### A7. Workload Identity Federation (keyless GitHub → GCP)

No JSON keys in GitHub. GitHub's OIDC token is exchanged for short-lived GCP
credentials, restricted to this one repo.

```bash
gcloud iam workload-identity-pools create github \
  --location=global --display-name="GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc github \
  --location=global --workload-identity-pool=github \
  --display-name="GitHub OIDC" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='${GITHUB_REPO}'"

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
export WIF_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/providers/github"

# Let this repo impersonate the deployer SA.
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/${GITHUB_REPO}"

echo "GitHub secret GCP_WIF_PROVIDER = $WIF_PROVIDER"
echo "GitHub secret GCP_DEPLOY_SA    = $DEPLOY_SA"
```

---

## PART B — First manual deploy (bootstrap)

Do this once by hand so a known-good baseline exists before automation. After
this, GitHub Actions (Part C) does exactly the same steps.

### B1. Build & push the first images

```bash
gcloud auth configure-docker "${REGION}-docker.pkg.dev"

docker build -t "${IMAGE_BACKEND}:bootstrap"  ./backend
docker build -t "${IMAGE_FRONTEND}:bootstrap" ./frontend
docker push "${IMAGE_BACKEND}:bootstrap"
docker push "${IMAGE_FRONTEND}:bootstrap"
```

Both Dockerfiles already default to their production stage (`runtime` /
`runner`); no `--target` needed.

### B2. Create the migration Job and run it

Migrations run **inside GCP** as a Cloud Run Job — same image, same secrets,
same Cloud SQL socket. Order is always **migrate → deploy** (migrations are
additive and backward-compatible; see the runbook).

```bash
gcloud run jobs create airgead-migrate \
  --region="$REGION" \
  --image="${IMAGE_BACKEND}:bootstrap" \
  --service-account="$RUN_SA" \
  --set-cloudsql-instances="$SQL_CONN" \
  --set-secrets="DB_URL=db-url:latest" \
  --command="npm" --args="run,migrate:up" \
  --max-retries=1 --task-timeout=600s

gcloud run jobs execute airgead-migrate --region="$REGION" --wait
```

A fresh database is fully created by `000_baseline` through the latest
migration — no seed. **Never** run `npm run seed` in prod (dev demo data only).

### B3. Deploy the backend service

```bash
gcloud run deploy airgead-backend \
  --region="$REGION" \
  --image="${IMAGE_BACKEND}:bootstrap" \
  --service-account="$RUN_SA" \
  --set-cloudsql-instances="$SQL_CONN" \
  --allow-unauthenticated \
  --port=8080 \
  --cpu=1 --memory=1Gi \                 # sharp (image resize) wants headroom
  --min-instances=1 \                    # warm pool: fast webhooks + DB pool
  --max-instances=10 \
  --concurrency=80 \
  --set-secrets="JWT_SECRET=jwt-secret:latest,DB_URL=db-url:latest,STRIPE_SECRET_KEY=stripe-secret-key:latest,STRIPE_WEBHOOK_SECRET=stripe-webhook-secret:latest,STRIPE_PRICE_SOLO=stripe-price-solo:latest,STRIPE_PRICE_SEAT=stripe-price-seat:latest,EMAIL_USERNAME=email-username:latest,EMAIL_PASSWORD=email-password:latest,SENTRY_DSN=sentry-dsn:latest" \
  --set-env-vars="NODE_ENV=production,STORAGE_DRIVER=gcs,GOOGLE_CLOUD_PROJECT_ID=${PROJECT_ID},GOOGLE_CLOUD_STORAGE_BUCKET=${BUCKET},REQUIRE_EMAIL_VERIFICATION=true,BILLING_ENFORCED=false,OCR_PROVIDER=none,OCR_AUTOFILL_ENABLED=false,FRONTEND_URL=https://app.${DOMAIN},PUBLIC_BACKEND_URL=https://api.${DOMAIN},CORS_ORIGINS=https://app.${DOMAIN}"

BACKEND_URL="$(gcloud run services describe airgead-backend --region="$REGION" --format='value(status.url)')"
echo "$BACKEND_URL"
curl -fsS "${BACKEND_URL}/health"   # → {"status":"ok"} proves DB connectivity
```

> Keep `BILLING_ENFORCED=false` until launch day (the GA switch — §9.3). On
> Cloud Run, **do not** set `GOOGLE_CREDENTIALS_JSON` / `GOOGLE_APPLICATION_CREDENTIALS`:
> leaving them unset makes the storage client use the runtime SA via ADC (A6),
> which is the keyless, rotation-free path.

### B4. Deploy the frontend service

The Next.js frontend talks to the backend **server-side** through its BFF
routes (`src/app/api/*`), so its only runtime var is `BACKEND_URL`.

```bash
gcloud run deploy airgead-frontend \
  --region="$REGION" \
  --image="${IMAGE_FRONTEND}:bootstrap" \
  --service-account="$RUN_SA" \
  --allow-unauthenticated \
  --port=3000 \
  --cpu=1 --memory=512Mi \
  --min-instances=1 --max-instances=10 --concurrency=80 \
  --set-env-vars="NODE_ENV=production,BACKEND_URL=https://api.${DOMAIN}"
```

> `NEXT_PUBLIC_*` values are **inlined at image build time**, not at deploy.
> The current defaults (`NEXT_PUBLIC_OCR_AUTOFILL_ENABLED=false`) are
> production-correct. If you ever need a different public flag, pass it as a
> `--build-arg` in the image build (see the frontend Dockerfile), not here.

### B5. Custom domains, TLS & WAF (production front door)

For production use a **Global External HTTPS Load Balancer** with serverless
NEGs (Cloud Run domain mappings are simpler but region-locked and lack WAF).
This gives one managed TLS cert, HTTP/2, Cloud CDN option, and **Cloud Armor**.

```bash
# Serverless NEGs → backend services
gcloud compute network-endpoint-groups create neg-frontend \
  --region="$REGION" --network-endpoint-type=serverless --cloud-run-service=airgead-frontend
gcloud compute network-endpoint-groups create neg-backend \
  --region="$REGION" --network-endpoint-type=serverless --cloud-run-service=airgead-backend

# Cloud Armor policy (rate-limit + OWASP preconfigured rules)
gcloud compute security-policies create airgead-waf --description="airgead edge WAF"
gcloud compute security-policies rules create 1000 --security-policy=airgead-waf \
  --expression="evaluatePreconfiguredExpr('xss-v33-stable')" --action=deny-403
gcloud compute security-policies update airgead-waf \
  --enable-layer7-ddos-defense

gcloud compute backend-services create bes-frontend --global \
  --load-balancing-scheme=EXTERNAL_MANAGED --security-policy=airgead-waf
gcloud compute backend-services add-backend bes-frontend --global \
  --network-endpoint-group=neg-frontend --network-endpoint-group-region="$REGION"
gcloud compute backend-services create bes-backend --global \
  --load-balancing-scheme=EXTERNAL_MANAGED --security-policy=airgead-waf
gcloud compute backend-services add-backend bes-backend --global \
  --network-endpoint-group=neg-backend --network-endpoint-group-region="$REGION"

# Host routing: app.<domain> → frontend, api.<domain> → backend
gcloud compute url-maps create airgead-lb --default-service bes-frontend
gcloud compute url-maps add-path-matcher airgead-lb \
  --path-matcher-name=api --default-service=bes-backend --new-hosts="api.${DOMAIN}"
gcloud compute url-maps add-host-rule airgead-lb --hosts="app.${DOMAIN}" --path-matcher-name=app 2>/dev/null || true

# Managed TLS for both hostnames
gcloud compute ssl-certificates create airgead-cert --global \
  --domains="app.${DOMAIN},api.${DOMAIN}"
gcloud compute target-https-proxies create airgead-https --url-map=airgead-lb --ssl-certificates=airgead-cert
gcloud compute addresses create airgead-ip --global
gcloud compute forwarding-rules create airgead-fr --global \
  --target-https-proxy=airgead-https --ports=443 --address=airgead-ip

gcloud compute addresses describe airgead-ip --global --format='value(address)'
```

Then create DNS **A records** for `app.${DOMAIN}` and `api.${DOMAIN}` pointing
at that IP. The managed cert goes `ACTIVE` within ~15–60 min once DNS resolves.
(Optionally add an HTTP:80 forwarding rule that 301-redirects to HTTPS.)

### B6. Wire Stripe & verify end-to-end

Follow §9.3 to create prices + the webhook endpoint
(`https://api.${DOMAIN}/billing/webhook`), then run the runbook smoke test:
`/health` ok, log in, add + delete an expense, `GET /billing/status`, upload a
receipt and confirm the signed-URL image loads.

---

## PART C — GitHub Actions auto-deploy (the CI/CD)

Every push to `main` runs: **lint · test · build** → **push images to Artifact
Registry** → **migrate** → **deploy backend** → **deploy frontend** →
**smoke test**. Keyless auth via WIF; images tagged by commit SHA for exact
rollbacks.

### C1. Configure GitHub

**Repository → Settings → Secrets and variables → Actions:**

| Kind | Name | Value |
|---|---|---|
| Secret | `GCP_WIF_PROVIDER` | the `projects/…/providers/github` string from A7 |
| Secret | `GCP_DEPLOY_SA` | `airgead-deployer@<project>.iam.gserviceaccount.com` |
| Variable | `GCP_PROJECT_ID` | your `$PROJECT_ID` |
| Variable | `GCP_REGION` | `europe-west1` |
| Variable | `DOMAIN` | `example.com` |

Create a **`production` environment** (Settings → Environments) and add required
reviewers if you want a manual approval gate before deploys.

### C2. `.github/workflows/deploy-gcp.yml`

This **replaces the `migrate` + `deploy` (Railway) jobs** in the current
`ci.yml`. Keep the existing `lint` / `test` / `build-frontend` jobs — either
leave them in `ci.yml` and let this file `needs:` nothing from them (run in
parallel), or fold everything into one file. The self-contained version:

```yaml
name: Deploy to GCP

on:
  push:
    branches: [main]
    paths-ignore: ['**/*.md', 'docs/**', '.gitignore', 'LICENSE']

concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: false        # never cancel a half-finished prod deploy

env:
  REGION: ${{ vars.GCP_REGION }}
  PROJECT_ID: ${{ vars.GCP_PROJECT_ID }}
  AR: ${{ vars.GCP_REGION }}-docker.pkg.dev/${{ vars.GCP_PROJECT_ID }}/airgead
  SQL_CONN: ${{ vars.GCP_PROJECT_ID }}:${{ vars.GCP_REGION }}:airgead-pg
  RUN_SA: airgead-run@${{ vars.GCP_PROJECT_ID }}.iam.gserviceaccount.com

jobs:
  ci:
    name: Lint · Test · Build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: cd frontend && npm ci && npm run build

  build-push:
    name: Build & push images
    needs: ci
    runs-on: ubuntu-latest
    permissions: { contents: read, id-token: write }
    outputs:
      sha: ${{ github.sha }}
    steps:
      - uses: actions/checkout@v5
      - uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.GCP_WIF_PROVIDER }}
          service_account: ${{ secrets.GCP_DEPLOY_SA }}
      - uses: google-github-actions/setup-gcloud@v2
      - run: gcloud auth configure-docker ${{ env.REGION }}-docker.pkg.dev --quiet
      - uses: docker/setup-buildx-action@v3
      - name: Backend image
        uses: docker/build-push-action@v6
        with:
          context: ./backend
          push: true
          tags: ${{ env.AR }}/backend:${{ github.sha }},${{ env.AR }}/backend:latest
          cache-from: type=gha,scope=backend
          cache-to: type=gha,scope=backend,mode=max
      - name: Frontend image
        uses: docker/build-push-action@v6
        with:
          context: ./frontend
          push: true
          tags: ${{ env.AR }}/frontend:${{ github.sha }},${{ env.AR }}/frontend:latest
          cache-from: type=gha,scope=frontend
          cache-to: type=gha,scope=frontend,mode=max

  migrate:
    name: Run DB migrations
    needs: build-push
    runs-on: ubuntu-latest
    environment: production        # optional manual-approval gate
    permissions: { contents: read, id-token: write }
    steps:
      - uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.GCP_WIF_PROVIDER }}
          service_account: ${{ secrets.GCP_DEPLOY_SA }}
      - uses: google-github-actions/setup-gcloud@v2
      - name: Point the job at the new image and run it
        run: |
          gcloud run jobs update airgead-migrate --region "$REGION" \
            --image "${AR}/backend:${{ github.sha }}"
          gcloud run jobs execute airgead-migrate --region "$REGION" --wait

  deploy-backend:
    name: Deploy backend
    needs: migrate
    runs-on: ubuntu-latest
    environment: production
    permissions: { contents: read, id-token: write }
    steps:
      - uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.GCP_WIF_PROVIDER }}
          service_account: ${{ secrets.GCP_DEPLOY_SA }}
      - uses: google-github-actions/setup-gcloud@v2
      - name: Deploy new revision (env/secrets already set on the service)
        run: |
          gcloud run deploy airgead-backend --region "$REGION" \
            --image "${AR}/backend:${{ github.sha }}"
      - name: Smoke test
        run: |
          URL=$(gcloud run services describe airgead-backend --region "$REGION" --format='value(status.url)')
          curl -fsS "${URL}/health" | grep -q '"ok"'

  deploy-frontend:
    name: Deploy frontend
    needs: deploy-backend      # backend healthy before frontend flips
    runs-on: ubuntu-latest
    environment: production
    permissions: { contents: read, id-token: write }
    steps:
      - uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.GCP_WIF_PROVIDER }}
          service_account: ${{ secrets.GCP_DEPLOY_SA }}
      - uses: google-github-actions/setup-gcloud@v2
      - run: gcloud run deploy airgead-frontend --region "$REGION" --image "${AR}/frontend:${{ github.sha }}"
```

> **Env/secrets live on the service, not in the workflow.** The bootstrap
> deploys (B3/B4) set `--set-secrets` / `--set-env-vars` once; subsequent
> `gcloud run deploy --image …` keeps them. To change config, either re-run a
> full `gcloud run services update` by hand or add a `--update-env-vars` step —
> config changes are deliberately a conscious act, not every-push drift.

### C3. Safer rollouts (optional but recommended)

Deploy new revisions **without** taking traffic, verify, then shift:

```yaml
# In deploy-backend, replace the deploy step with:
- run: |
    gcloud run deploy airgead-backend --region "$REGION" \
      --image "${AR}/backend:${{ github.sha }}" \
      --no-traffic --tag "s${GITHUB_SHA::7}"
    # smoke-test the tagged revision URL, then:
    gcloud run services update-traffic airgead-backend --region "$REGION" --to-latest
```

For canary: `--to-tags s<sha>=10` sends 10% first, then ramp to 100.

---

## PART D — Environment variable matrix

Source of truth is the code (`validateEnv.js` decides what is boot-fatal).
**FATAL in production** = the container refuses to start without it.

### Backend (`airgead-backend`)

| Variable | Where | Prod value / note |
|---|---|---|
| `NODE_ENV` | env | `production` |
| `PORT` | auto | Cloud Run injects `8080` |
| `DB_URL` | **secret** | Cloud SQL socket string. **FATAL** |
| `JWT_SECRET` | **secret** | ≥32-char random. **FATAL** (weak = refuse boot) |
| `FRONTEND_URL` | env | `https://app.<domain>`. **FATAL** |
| `PUBLIC_BACKEND_URL` | env | `https://api.<domain>` (signed URLs, verify links) |
| `CORS_ORIGINS` | env | `https://app.<domain>` (warn if unset in prod) |
| `STORAGE_DRIVER` | env | `gcs` |
| `GOOGLE_CLOUD_PROJECT_ID` | env | `<project>` |
| `GOOGLE_CLOUD_STORAGE_BUCKET` | env | `<project>-receipts` |
| `GOOGLE_CREDENTIALS_JSON` / `GOOGLE_APPLICATION_CREDENTIALS` | — | **leave unset** → ADC via runtime SA |
| `EMAIL_USERNAME` / `EMAIL_PASSWORD` | **secret** | Gmail addr + App Password (warn if unset) |
| `REQUIRE_EMAIL_VERIFICATION` | env | `true` |
| `BILLING_ENFORCED` | env | `false` until GA, then `true` |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | **secret** | live keys once billing on |
| `STRIPE_PRICE_SOLO` / `STRIPE_PRICE_SEAT` | **secret** | recurring price ids |
| `SENTRY_DSN` | **secret** | enables Sentry |
| `OCR_PROVIDER` / `OCR_AUTOFILL_ENABLED` | env | `none` / `false` (dormant — keep off) |

### Frontend (`airgead-frontend`)

| Variable | Where | Prod value |
|---|---|---|
| `NODE_ENV` | env | `production` |
| `PORT` | auto | Cloud Run injects `8080` (Next standalone honours it) |
| `BACKEND_URL` | env | `https://api.<domain>` (server-side BFF target) |
| `NEXT_PUBLIC_OCR_AUTOFILL_ENABLED` | build-arg | `false` (image build time) |

---

## PART E — Feature setup notes

### 9.1 Image storage (Cloud Storage)
Done in A4/A6. `STORAGE_DRIVER=gcs` + bucket + `serviceAccountTokenCreator`
self-binding is all it takes; objects are private, served via V4 signed URLs.
Object keys follow `org_{id}/{year}/{receipt_id}.{ext}` so lifecycle/export/
delete are per-tenant. GDPR hard-delete (super-admin) removes the object too —
that is why the runtime SA has `objectAdmin`, not just viewer.

### 9.2 Database (Cloud SQL)
Done in A3. Migrations run as the `airgead-migrate` job (B2/C-migrate). Backups:
automated daily + PITR (enabled at creation). Restore drill and `pg_dump` belt-
and-braces are in `runbook-production.md` — keep using it; only the host changed.

### 9.3 Stripe payments
1. Stripe Dashboard → create two **recurring monthly** prices → ids into
   `stripe-price-solo` / `stripe-price-seat` secrets.
2. Developers → Webhooks → add endpoint `https://api.<domain>/billing/webhook`
   for `checkout.session.completed`, `customer.subscription.{created,updated,deleted}`.
   Copy the signing secret → `stripe-webhook-secret`.
3. Set `stripe-secret-key`. Redeploy backend. Test a checkout with a test card
   while `BILLING_ENFORCED=false`.
4. **GA switch:** set `BILLING_ENFORCED=true`
   (`gcloud run services update airgead-backend --update-env-vars BILLING_ENFORCED=true`).
   The webhook handler mounts `express.raw` before the JSON parser and verifies
   signatures, so it must sit behind the LB unmolested — it does.

### 9.4 Email (SMTP)
The code uses **nodemailer against Gmail SMTP** (`smtp.gmail.com:465`,
`service:'Gmail'`) with `EMAIL_USERNAME` + `EMAIL_PASSWORD`. Cloud Run allows
outbound 465/587 (only port 25 is blocked), so Gmail works out of the box:
1. Use a Workspace mailbox (e.g. `noreply@<domain>`), enable 2FA, create an
   **App Password**, put it in `email-password`.
2. Higher volume / better deliverability (SendGrid, Mailgun, Postmark, Resend)
   needs a **small code change** — the transport is currently hard-coded to
   Gmail in `userController.js`. Swap it to a generic `host/port/auth` transport
   and set SPF/DKIM on your domain before launch.

### 9.5 Error tracking (Sentry)
Set `sentry-dsn`; Sentry loads only when the DSN is present. Request IDs
(`x-request-id`, AsyncLocalStorage → winston) correlate Cloud Logging lines with
Sentry issues.

### 9.6 OCR (dormant)
Leave `OCR_PROVIDER=none` / `OCR_AUTOFILL_ENABLED=false`. When a vendor is
chosen (EU residency required), flip these + add the provider key as a new
secret — no infra change.

---

## PART F — Production hardening checklist

- **Availability:** `min-instances=1` on both services (no cold-start on the
  first request; keeps the DB pool warm for webhooks). `REGIONAL` Cloud SQL for
  HA failover.
- **Sizing:** backend `1 vCPU / 1Gi` (sharp needs memory); frontend
  `1 vCPU / 512Mi`. Raise `max-instances` from load tests; watch Cloud SQL
  `max_connections` vs `instances × pool size`.
- **Edge:** Cloud Armor with preconfigured OWASP rules + L7 DDoS + a per-IP rate
  limit rule. The app *also* has helmet + global 300/15min and auth 10/15min
  limiters — defence in depth.
- **TLS:** managed cert on the LB; enforce HTTPS redirect; HSTS via helmet.
- **Secrets:** all in Secret Manager, referenced by `:latest`. Rotation is
  "add a new version + redeploy" (see runbook: JWT/Stripe/SMTP rotation).
- **Backups:** Cloud SQL PITR ≥ 14 days + nightly automated backups. Bucket
  versioning is the image backup. Quarterly restore-test into a scratch DB.
- **Observability:**
  ```bash
  # Uptime check + alert on the health endpoint
  gcloud monitoring uptime create airgead-backend-health \
    --resource-type=uptime-url --host="api.${DOMAIN}" --path="/health"
  ```
  Add alert policies: Cloud Run 5xx rate, request latency p95, container
  restarts, Cloud SQL CPU/connections/disk, and a **log-based metric** on
  `severity=ERROR`. Route to email/Slack/PagerDuty.
- **Least privilege:** distinct runtime vs deployer SAs (A6); WIF scoped to the
  single repo (A7); bucket public-access-prevention on; Cloud SQL no public IP.

---

## PART G — Day-2 operations

| Task | Command / action |
|---|---|
| **Rollback** app | `gcloud run services update-traffic airgead-backend --region $REGION --to-revisions <PREV>=100` (revisions are per-SHA; instant, no rebuild) |
| **Roll config** | `gcloud run services update airgead-backend --update-env-vars KEY=VAL` (new revision) |
| **Flip billing on** | set `BILLING_ENFORCED=true` (§9.3) |
| **Rotate a secret** | `gcloud secrets versions add <name> --data-file=-` → redeploy |
| **DB console** | `gcloud sql connect airgead-pg --user=airgead_app` |
| **Ad-hoc migrate** | `gcloud run jobs execute airgead-migrate --region $REGION --wait` |
| **Tail logs** | `gcloud run services logs read airgead-backend --region $REGION` (filter by `x-request-id`) |
| **Scale for tax season** | raise `--max-instances` and the Cloud SQL tier before Oct–Nov |

Emergency, incident, GDPR-erasure, webhook-replay and JWT/Stripe rotation
procedures are unchanged from `docs/runbook-production.md` — that runbook stays
authoritative for *operations*; this document owns *infrastructure & CI/CD*.

---

## Rough monthly cost (small production, `europe-west1`)

| Item | Config | ~€/mo |
|---|---|---|
| Cloud Run (2 svc, min-1) | 2× always-warm 1 vCPU | 25–45 |
| Cloud SQL Postgres | `db-custom-1-3840`, REGIONAL HA | 70–100 (ZONAL ≈ half) |
| Cloud Storage | receipts + lifecycle tiering | 1–10 (grows slowly) |
| HTTPS LB + Cloud Armor | 1 rule set | ~20 |
| Secret Manager / logging | low volume | 1–5 |
| **Total** | | **~120–180** |

Cheapest viable vaairgeadt: `min-instances=0` + `ZONAL` Cloud SQL + Cloud Run
domain mappings instead of the LB → **~€35–60/mo**, at the cost of cold starts
and no edge WAF.

---

### What to do next

1. Run **Part A** (foundation) then **Part B** (bootstrap) once.
2. Add the GitHub secrets/variables (C1) and commit `deploy-gcp.yml` (C2).
3. Push to `main` → watch the pipeline migrate + deploy automatically.
4. On launch day, follow §9.3 to flip `BILLING_ENFORCED=true`.
