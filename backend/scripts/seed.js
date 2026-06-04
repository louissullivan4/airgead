/*
 * Local development seed.
 *
 * The production schema is not yet captured in the repo (see db/SCHEMA_REQUIRED.md
 * / docs/schema-capture.md), so a fresh local Postgres has no tables. This script
 * is a DEV-ONLY convenience: it creates a schema that matches what the app code
 * expects (including the Phase 0 org columns) and inserts a demo org + user +
 * sample transactions so you can log in and click around immediately.
 *
 * It is idempotent — re-running wipes and recreates the demo rows (identified by
 * fixed UUIDs) without touching anything else.
 *
 * Run it inside the backend container (bcrypt is guaranteed there):
 *     docker compose exec backend npm run seed
 * or from the host against the published port:
 *     DB_URL=postgres://postgres:postgres@localhost:5432/equiledger npm run seed
 *
 * NOTE: this schema is for local dev only. It is NOT the source of truth for the
 * production schema.
 */

const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const DB_URL =
  process.env.DB_URL || 'postgres://postgres:postgres@localhost:5432/equiledger';

const DEMO_ORG_ID = '00000000-0000-0000-0000-0000000000a1';
const DEMO_USER_ID = '00000000-0000-0000-0000-0000000000b1';
const DEMO_EMAIL = 'demo@rian.dev';
const DEMO_PASSWORD = 'Password123!';

const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS organisations (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name               text NOT NULL,
    type               text NOT NULL DEFAULT 'personal' CHECK (type IN ('personal','business')),
    owner_account_id   uuid,
    subscription_level text,
    renewal_date       date,
    is_auto_renew      boolean,
    payment_method     text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    fname              text,
    mname              text DEFAULT '',
    sname              text,
    email              text UNIQUE NOT NULL,
    phone_number       text,
    date_of_birth      date,
    ppsno              text,
    address_line1      text,
    address_line2      text DEFAULT '',
    city               text,
    county             text DEFAULT '',
    country            text,
    tax_status         text,
    marital_status     text,
    postal_code        text DEFAULT '',
    occupation         text,
    currency           text NOT NULL DEFAULT 'EUR',
    password_hash      text NOT NULL,
    inviter_id         uuid,
    id_image_url       text,
    poa_image_url      text,
    role               text NOT NULL DEFAULT 'user',
    account_status     text DEFAULT 'active',
    subscription_level text DEFAULT 'free',
    renewal_date       date,
    is_auto_renew      boolean DEFAULT false,
    payment_method     text,
    last_login         timestamptz,
    org_id             uuid REFERENCES organisations(id),
    org_role           text DEFAULT 'owner' CHECK (org_role IN ('owner','member')),
    platform_role      text DEFAULT 'user' CHECK (platform_role IN ('user','super_admin')),
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expenses (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title              text,
    description        text,
    category           text,
    amount             numeric(12,2) NOT NULL DEFAULT 0,
    currency           text NOT NULL DEFAULT 'EUR',
    receipt_image_url  text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_invites (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email              text NOT NULL,
    invite_token       text NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now()
);

-- owner FK added after both tables exist; guarded so re-runs are safe.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organisations_owner_account_id_fkey') THEN
        ALTER TABLE organisations
            ADD CONSTRAINT organisations_owner_account_id_fkey
            FOREIGN KEY (owner_account_id) REFERENCES users(id);
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_users_org_id ON users(org_id);
CREATE INDEX IF NOT EXISTS idx_expenses_user_id ON expenses(user_id);
`;

// A spread of demo transactions across the current calendar (tax) year.
const YEAR = new Date().getFullYear();
const d = (month, day) => new Date(Date.UTC(YEAR, month, day)).toISOString();

const DEMO_TX = [
  { title: 'January salary', category: 'income', amount: 3200, at: d(0, 28) },
  { title: 'February salary', category: 'income', amount: 3200, at: d(1, 26) },
  { title: 'Consulting payment', category: 'income', amount: 850, at: d(2, 15) },
  { title: 'Office chair', category: 'equipment', amount: 189.99, at: d(0, 12) },
  { title: 'Train to client', category: 'travel', amount: 42.5, at: d(1, 3) },
  { title: 'Team lunch', category: 'meals', amount: 76.2, at: d(1, 19) },
  { title: 'Cloud hosting', category: 'software', amount: 29, at: d(2, 1) },
  { title: 'Accountant fee', category: 'professional', amount: 250, at: d(2, 22) },
  { title: 'Electricity', category: 'utilities', amount: 88.4, at: d(3, 5) },
  { title: 'Printer paper', category: 'office', amount: 14.99, at: d(3, 16) },
  { title: 'Flight to conference', category: 'travel', amount: 320, at: d(4, 9) },
  { title: 'Design software', category: 'software', amount: 55, at: d(4, 21) },
];

async function main() {
  const pool = new Pool({ connectionString: DB_URL });
  const client = await pool.connect();
  try {
    console.log(`Connecting to ${DB_URL.replace(/:[^:@/]*@/, ':****@')}`);
    console.log('Ensuring schema…');
    await client.query(SCHEMA_SQL);

    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

    await client.query('BEGIN');

    // Reset demo rows (order respects FKs).
    await client.query('DELETE FROM expenses WHERE user_id = $1', [DEMO_USER_ID]);
    await client.query(
      'UPDATE organisations SET owner_account_id = NULL WHERE id = $1',
      [DEMO_ORG_ID],
    );
    await client.query('DELETE FROM users WHERE id = $1 OR email = $2', [
      DEMO_USER_ID,
      DEMO_EMAIL,
    ]);
    await client.query('DELETE FROM organisations WHERE id = $1', [DEMO_ORG_ID]);

    await client.query(
      `INSERT INTO organisations (id, name, type) VALUES ($1, 'Demo Org', 'personal')`,
      [DEMO_ORG_ID],
    );

    await client.query(
      `INSERT INTO users (
          id, fname, sname, email, currency, password_hash, role,
          org_id, org_role, platform_role
       ) VALUES ($1,'Demo','User',$2,'EUR',$3,'user',$4,'owner','user')`,
      [DEMO_USER_ID, DEMO_EMAIL, passwordHash, DEMO_ORG_ID],
    );

    await client.query(
      'UPDATE organisations SET owner_account_id = $1 WHERE id = $2',
      [DEMO_USER_ID, DEMO_ORG_ID],
    );

    for (const tx of DEMO_TX) {
      await client.query(
        `INSERT INTO expenses (user_id, title, description, category, amount, currency, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,'EUR',$6,$6)`,
        [DEMO_USER_ID, tx.title, '', tx.category, tx.amount, tx.at],
      );
    }

    await client.query('COMMIT');

    console.log('\n✅ Seeded demo data');
    console.log(`   ${DEMO_TX.length} transactions for ${DEMO_EMAIL}`);
    console.log('\n   Log in with:');
    console.log(`     email:    ${DEMO_EMAIL}`);
    console.log(`     password: ${DEMO_PASSWORD}\n`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Seed failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
