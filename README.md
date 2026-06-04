# rian

Expense tracking and ledger management.

> Formerly "EquiLedger" — see `docs/rename-runbook.md` for the in-progress rename.

## Structure

```
rian/
├── backend/        Express + PostgreSQL API
├── frontend/       Next.js web app
├── db/             Database scripts
└── docker-compose.yml
```

## Getting started

### Prerequisites

- Docker & Docker Compose
- Node.js 20+ (for local development without Docker)

### With Docker (recommended)

```bash
# Copy env files
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local

# Edit both files with your values, then:
docker compose up
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:8080
- PostgreSQL: localhost:5432

### Without Docker

**Backend**
```bash
cd backend
cp .env.example .env   # edit with your DB credentials
npm install
npm run dev
```

**Frontend**
```bash
cd frontend
cp .env.local.example .env.local
npm install
npm run dev
```

## API

The backend exposes:

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/users/login` | — | Login |
| POST | `/users/signup` | — | Register |
| GET | `/users` | admin/accountant | List users |
| GET | `/expenses/users/:id` | token | User expenses |
| POST | `/expenses` | token | Create expense |
| PUT | `/expenses/:id` | token | Update expense |
| DELETE | `/expenses/:id` | token | Delete expense |

See `backend/src/routes/` for the full route list.
