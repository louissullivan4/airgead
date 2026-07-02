#!/usr/bin/env bash
#
# Bring up the full rian stack locally (Postgres + backend + frontend) and seed
# demo data, ready for manual testing. Safe to re-run.
#
#   npm run local           # from the repo root
#   bash scripts/dev.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."

# Pick a free host port for Postgres. A local Postgres on 5432 is common; the
# containers always talk over the internal network on 5432 regardless.
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
if (exec 3<>/dev/tcp/127.0.0.1/"${POSTGRES_PORT}") 2>/dev/null; then
  exec 3>&- 3<&- || true
  echo "▶ Host port ${POSTGRES_PORT} is in use - exposing Postgres on 5433 instead."
  POSTGRES_PORT=5433
fi
export POSTGRES_PORT

echo "▶ Building & starting containers (postgres + backend + frontend)…"
docker compose up -d --build

echo "▶ Waiting for the backend to come up…"
for i in $(seq 1 60); do
  if curl -sf http://localhost:8080/ >/dev/null 2>&1; then
    echo "  backend is up."
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "✗ Backend did not become ready in time. Check: docker compose logs backend"
    exit 1
  fi
  sleep 2
done

echo "▶ Running database migrations…"
docker compose exec -T backend npm run migrate:up

echo "▶ Seeding demo data…"
docker compose exec -T backend npm run seed

cat <<'EOF'

────────────────────────────────────────────────────────
✅ rian is running

   Frontend:  http://localhost:3000
   Backend:   http://localhost:8080

   Demo login:
     email:     demo@rian.dev
     password:  Password123!

   (The frontend's first load compiles on demand - give it a few seconds.)

   Logs:   docker compose logs -f
   Reseed: npm run seed   (or: docker compose exec backend npm run seed)
   Stop:   docker compose down
   Reset:  docker compose down -v   (also wipes the database)
────────────────────────────────────────────────────────
EOF
