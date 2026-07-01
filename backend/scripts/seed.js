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
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name                   text NOT NULL,
    type                   text NOT NULL DEFAULT 'personal' CHECK (type IN ('personal','business')),
    org_category           text NOT NULL DEFAULT 'personal',
    is_accountant_practice boolean NOT NULL DEFAULT false,
    status                 text NOT NULL DEFAULT 'active',
    owner_account_id       uuid,
    subscription_level     text,
    renewal_date           date,
    is_auto_renew          boolean,
    payment_method         text,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now()
);

-- Guarded for pre-existing local DBs created before these columns landed.
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS org_category text NOT NULL DEFAULT 'personal';
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS is_accountant_practice boolean NOT NULL DEFAULT false;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS vat_status text NOT NULL DEFAULT 'not_registered';

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

CREATE TABLE IF NOT EXISTS receipts (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    image_object_path  text,
    parsed_data        jsonb,
    ocr_confidence     numeric,
    receipt_status     text NOT NULL DEFAULT 'reviewed' CHECK (receipt_status IN ('pending','reviewed','none')),
    merchant_name      text,
    receipt_date       date,
    total_amount       numeric,
    tax_amount         numeric,
    currency           text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expenses (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receipt_id         uuid REFERENCES receipts(id) ON DELETE SET NULL,
    title              text,
    description        text,
    category           text,
    amount             numeric(12,2) NOT NULL DEFAULT 0,
    currency           text NOT NULL DEFAULT 'EUR',
    merchant_name      text,
    tax_amount         numeric,
    receipt_image_url  text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Phase 5: capital-asset register. An expense is capital iff an assets row
-- references it; wear & tear is computed from these rows, never stored.
CREATE TABLE IF NOT EXISTS assets (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expense_id         uuid REFERENCES expenses(id) ON DELETE CASCADE,
    description        text NOT NULL,
    category           text,
    asset_type         text NOT NULL DEFAULT 'plant_machinery' CHECK (asset_type IN ('plant_machinery','motor_vehicle')),
    cost               numeric(12,2) NOT NULL,
    currency           text NOT NULL DEFAULT 'EUR',
    acquired_date      date NOT NULL,
    disposal_date      date,
    disposal_proceeds  numeric(12,2),
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_invites (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email              text NOT NULL,
    invite_token       text NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now()
);

-- Phase 3: accountant practice ↔ client org grants (read + export access).
CREATE TABLE IF NOT EXISTS accountant_org_links (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    accountant_org_id  uuid NOT NULL REFERENCES organisations(id),
    client_org_id      uuid NOT NULL REFERENCES organisations(id),
    created_by         uuid REFERENCES users(id),
    status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','revoked')),
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (accountant_org_id, client_org_id)
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
CREATE INDEX IF NOT EXISTS idx_assets_user_id ON assets(user_id);
CREATE INDEX IF NOT EXISTS idx_assets_expense_id ON assets(expense_id);
CREATE INDEX IF NOT EXISTS idx_expenses_receipt_id ON expenses(receipt_id);
CREATE INDEX IF NOT EXISTS idx_receipts_user_id ON receipts(user_id);
CREATE INDEX IF NOT EXISTS idx_accountant_org_links_accountant ON accountant_org_links(accountant_org_id);
CREATE INDEX IF NOT EXISTS idx_accountant_org_links_client ON accountant_org_links(client_org_id);
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

// Phase 3 / 3.1 accountant firm demo: a practice org with an ADMIN accountant
// (owner) and a STAFF accountant (member). Each client is owned by the
// accountant who "invited" it (accountant_org_links.created_by): the admin owns
// Galway Equine, the staff accountant owns Murphy Retail. Logging in as the
// admin shows both clients; as the staff accountant shows only Murphy Retail.
const ACCT_ORG_ID = '00000000-0000-0000-0000-0000000000a2';
const ACCT_USER_ID = '00000000-0000-0000-0000-0000000000b2';
const ACCT_EMAIL = 'accountant@rian.dev';

// Staff accountant — a member of the firm above.
const ACCT2_USER_ID = '00000000-0000-0000-0000-0000000000b5';
const ACCT2_EMAIL = 'accountant2@rian.dev';

const DEMO_CLIENTS = [
  {
    orgId: '00000000-0000-0000-0000-0000000000a3',
    userId: '00000000-0000-0000-0000-0000000000b3',
    orgName: 'Galway Equine',
    orgCategory: 'sole_trader_equine',
    email: 'client1@rian.dev',
    fname: 'Aoife',
    sname: 'Byrne',
    ownerUserId: ACCT_USER_ID, // owned by the admin accountant
    vatStatus: 'flat_rate_farmer',
    tx: [
      { title: 'Livery income', category: 'income', amount: 1200, at: d(0, 14) },
      { title: 'Lessons income', category: 'income', amount: 640, at: d(1, 9) },
      { title: 'Feed & bedding', category: 'feed_bedding', amount: 540, at: d(0, 18) },
      { title: 'Vet visit', category: 'vet_fees', amount: 180, at: d(2, 9) },
      { title: 'Diesel', category: 'fuel', amount: 95.4, at: d(3, 11) },
      // Capital item: lands in the asset register, claimed via wear & tear
      // (12.5%/yr over 8 years) instead of as a revenue expense.
      {
        title: 'Ifor Williams horsebox', category: 'tack_equipment', amount: 8400, at: d(1, 2),
        capital: { description: 'Ifor Williams HB511 horsebox', asset_type: 'plant_machinery' },
      },
    ],
  },
  {
    orgId: '00000000-0000-0000-0000-0000000000a4',
    userId: '00000000-0000-0000-0000-0000000000b4',
    orgName: 'Murphy Retail',
    orgCategory: 'retail',
    email: 'client2@rian.dev',
    fname: 'Sean',
    sname: 'Murphy',
    ownerUserId: ACCT2_USER_ID, // owned by the staff accountant
    vatStatus: 'registered',
    tx: [
      { title: 'Shop sales', category: 'income', amount: 4100, at: d(1, 15) },
      { title: 'Stock purchase', category: 'equipment', amount: 2300, at: d(0, 7) },
      { title: 'POS software', category: 'software', amount: 39, at: d(2, 1) },
      { title: 'Electricity', category: 'utilities', amount: 120.5, at: d(3, 20) },
    ],
  },
];

async function main() {
  const pool = new Pool({ connectionString: DB_URL });
  const client = await pool.connect();
  try {
    console.log(`Connecting to ${DB_URL.replace(/:[^:@/]*@/, ':****@')}`);
    console.log('Ensuring schema…');
    await client.query(SCHEMA_SQL);

    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

    // Helpers (capture `client`/`passwordHash` from scope). Queries run
    // sequentially — a single pg client can't execute concurrent queries.
    const insertTx = async (userId, txns) => {
      for (const tx of txns) {
        const inserted = await client.query(
          `INSERT INTO expenses (user_id, title, description, category, amount, currency, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,'EUR',$6,$6) RETURNING id`,
          [userId, tx.title, '', tx.category, tx.amount, tx.at],
        );
        // A `capital` marker also writes the linked asset-register row (the
        // in-app flow does this transactionally on save).
        if (tx.capital) {
          await client.query(
            `INSERT INTO assets (user_id, expense_id, description, category, asset_type, cost, currency, acquired_date)
             VALUES ($1,$2,$3,$4,$5,$6,'EUR',$7)`,
            [userId, inserted.rows[0].id, tx.capital.description, tx.category,
              tx.capital.asset_type || 'plant_machinery', tx.amount, tx.at],
          );
        }
      }
    };

    const insertOrgWithOwner = async (o) => {
      await client.query(
        `INSERT INTO organisations (id, name, type, org_category, is_accountant_practice, vat_status)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [o.orgId, o.orgName, o.orgType, o.orgCategory, Boolean(o.isPractice), o.vatStatus || 'not_registered'],
      );
      await client.query(
        `INSERT INTO users (
            id, fname, sname, email, currency, password_hash, role,
            org_id, org_role, platform_role
         ) VALUES ($1,$2,$3,$4,'EUR',$5,$6,$7,'owner',$8)`,
        [o.userId, o.fname, o.sname, o.email, passwordHash, o.role, o.orgId, o.platformRole || 'user'],
      );
      await client.query('UPDATE organisations SET owner_account_id = $1 WHERE id = $2', [o.userId, o.orgId]);
    };

    // Every demo id this script owns (original personal demo + accountant flow).
    const allOrgIds = [DEMO_ORG_ID, ACCT_ORG_ID, ...DEMO_CLIENTS.map((c) => c.orgId)];
    const allUserIds = [DEMO_USER_ID, ACCT_USER_ID, ACCT2_USER_ID, ...DEMO_CLIENTS.map((c) => c.userId)];
    const allEmails = [DEMO_EMAIL, ACCT_EMAIL, ACCT2_EMAIL, ...DEMO_CLIENTS.map((c) => c.email)];

    await client.query('BEGIN');

    // Reset demo rows (order respects FKs).
    await client.query(
      'DELETE FROM accountant_org_links WHERE accountant_org_id = ANY($1) OR client_org_id = ANY($1)',
      [allOrgIds],
    );
    await client.query('DELETE FROM assets WHERE user_id = ANY($1)', [allUserIds]);
    await client.query('DELETE FROM expenses WHERE user_id = ANY($1)', [allUserIds]);
    await client.query('UPDATE organisations SET owner_account_id = NULL WHERE id = ANY($1)', [allOrgIds]);
    await client.query('DELETE FROM users WHERE id = ANY($1) OR email = ANY($2)', [allUserIds, allEmails]);
    await client.query('DELETE FROM organisations WHERE id = ANY($1)', [allOrgIds]);

    // Original personal demo account — doubles as the platform super admin for now.
    await insertOrgWithOwner({
      orgId: DEMO_ORG_ID, userId: DEMO_USER_ID, orgName: 'Demo Org', orgType: 'personal',
      orgCategory: 'personal', email: DEMO_EMAIL, fname: 'Demo', sname: 'User',
      role: 'user', isPractice: false, platformRole: 'super_admin',
    });
    await insertTx(DEMO_USER_ID, DEMO_TX);

    // Accountant practice (flagged) + its admin (owner) accountant.
    await insertOrgWithOwner({
      orgId: ACCT_ORG_ID, userId: ACCT_USER_ID, orgName: 'Rian Accountancy', orgType: 'business',
      orgCategory: 'consultant', email: ACCT_EMAIL, fname: 'Áine', sname: 'Kelly', role: 'accountant', isPractice: true,
    });

    // Staff accountant — a MEMBER of the firm (org_role 'member').
    await client.query(
      `INSERT INTO users (
          id, fname, sname, email, currency, password_hash, role,
          org_id, org_role, platform_role
       ) VALUES ($1,'Cathal','Walsh',$2,'EUR',$3,'accountant',$4,'member','user')`,
      [ACCT2_USER_ID, ACCT2_EMAIL, passwordHash, ACCT_ORG_ID],
    );

    // Client orgs, each linked active and OWNED by a specific accountant
    // (created_by) so the admin-sees-all vs member-sees-own split is testable.
    for (const c of DEMO_CLIENTS) {
      await insertOrgWithOwner({
        orgId: c.orgId, userId: c.userId, orgName: c.orgName, orgType: 'business',
        orgCategory: c.orgCategory, email: c.email, fname: c.fname, sname: c.sname, role: 'user', isPractice: false,
        vatStatus: c.vatStatus,
      });
      await insertTx(c.userId, c.tx);
      await client.query(
        `INSERT INTO accountant_org_links (accountant_org_id, client_org_id, created_by, status)
         VALUES ($1,$2,$3,'active')`,
        [ACCT_ORG_ID, c.orgId, c.ownerUserId],
      );
    }

    await client.query('COMMIT');

    console.log('\n✅ Seeded demo data');
    console.log(`   Personal demo: ${DEMO_TX.length} transactions for ${DEMO_EMAIL}`);
    console.log('   Accountancy firm "Rian Accountancy" — admin + staff accountant:');
    DEMO_CLIENTS.forEach((c) =>
      console.log(
        `     • ${c.orgName} (${c.tx.length} txns) → owned by ${c.ownerUserId === ACCT_USER_ID ? 'admin' : 'staff'}`,
      ),
    );
    console.log(`\n   All accounts share the password: ${DEMO_PASSWORD}`);
    console.log('\n   Super admin (whole-platform Admin dashboard) — also the personal demo user:');
    console.log(`     email:    ${DEMO_EMAIL}`);
    console.log('   Admin accountant (sees BOTH clients, manages the team, can reassign):');
    console.log(`     email:    ${ACCT_EMAIL}`);
    console.log('   Staff accountant (sees ONLY Murphy Retail):');
    console.log(`     email:    ${ACCT2_EMAIL}\n`);
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
