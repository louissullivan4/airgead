/*
 * Phase 6 live E2E drive: billing gate, covered seats, webhooks, email
 * verification — against a REAL running backend + database (dev only).
 *
 * Setup expected (see docs/runbook-production.md "First-ever bootstrap"):
 *   1. throwaway Postgres, `npm run migrate:up`, `npm run seed`
 *   2. backend booted with:
 *        BILLING_ENFORCED=true
 *        STRIPE_SECRET_KEY=sk_test_dummy  STRIPE_WEBHOOK_SECRET=whsec_dummy
 *        (dummy values are enough for signature-rejection tests)
 *        NODE_ENV=test   (skips rate limiters so the drive's logins don't trip them)
 *   3. run: DB_URL=... JWT_SECRET=<same as server> BASE=http://localhost:58080 \
 *          node scripts/e2e-phase6.mjs
 *
 * The script flips org billing states directly in SQL to simulate expiry and
 * restores everything it changed.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const BASE = process.env.BASE || 'http://localhost:58080';
const DB_URL = process.env.DB_URL || 'postgres://postgres:postgres@localhost:55432/airgead_test';
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('Set JWT_SECRET to the same value the server booted with.');
  process.exit(1);
}

const pool = new Pool({ connectionString: DB_URL });
let failures = 0;
const ok = (cond, label, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
};

const req = async (path, { method = 'GET', token, body, headers = {}, redirect } = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    redirect: redirect || 'follow',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* redirects/HTML */ }
  return { status: res.status, json, text, headers: res.headers };
};

const login = async (email) => {
  const r = await req('/users/login', { method: 'POST', body: { email, password: 'Password123!' } });
  if (!r.json?.token) throw new Error(`login failed for ${email}: ${r.status} ${r.text.slice(0, 140)}`);
  return r.json.token;
};

const setBilling = (orgName, billingStatus, trialDelta) => pool.query(
  `UPDATE organisations SET billing_status = $2,
      trial_ends_at = now() + ($3 || ' days')::interval
   WHERE name = $1`,
  [orgName, billingStatus, String(trialDelta)],
);

// --- 0. health -------------------------------------------------------------
const health = await req('/health');
ok(health.status === 200 && health.json?.status === 'ok', '/health is 200 ok');

// --- 1. practice entitlement ------------------------------------------------
const acct = await login('accountant@airgead.dev');
const acctBill = await req('/billing/status', { token: acct });
ok(acctBill.json?.enforced === true, 'billing is ENFORCED for this drive');
ok(acctBill.json?.active === true && acctBill.json?.reason === 'practice', 'practice org is always active', acctBill.json?.reason);
ok(acctBill.json?.seatCount === 2, 'practice sees its 2 active client seats', `got ${acctBill.json?.seatCount}`);

// --- 2. covered seat --------------------------------------------------------
// Seed marks every demo org as its own subscriber; make Galway rely on COVER.
await setBilling('Galway Equine', 'none', -5); // own trial expired, no own billing
const client = await login('client1@airgead.dev');
const covered = await req('/billing/status', { token: client });
ok(covered.json?.active === true && covered.json?.reason === 'covered_seat',
  'client of a paying practice is a covered seat', covered.json?.reason);
const coveredWrite = await req('/expenses', {
  method: 'POST', token: client,
  body: { title: 'Covered-seat write', category: 'feed_bedding', amount: 10, currency: 'EUR' },
});
ok(coveredWrite.status === 201, 'covered seat can write');

// --- 3. cover collapses when the practice stops paying ----------------------
await setBilling('Airgead Accountancy', 'canceled', -5);
const blockedWrite = await req('/expenses', {
  method: 'POST', token: client,
  body: { title: 'Should be blocked', category: 'feed_bedding', amount: 10, currency: 'EUR' },
});
ok(blockedWrite.status === 402 && blockedWrite.json?.code === 'subscription_required',
  'expired org gets 402 subscription_required on WRITE', `status ${blockedWrite.status}`);
const readWhileExpired = await req('/expenses/users/00000000-0000-0000-0000-0000000000b3', { token: client });
ok(readWhileExpired.status === 200, 'READS stay open for the expired org');
const taxWhileExpired = await req('/reports/tax-summary', { token: client });
ok(taxWhileExpired.status === 200, 'tax summary stays open for the expired org');
const statusWhileExpired = await req('/billing/status', { token: client });
ok(statusWhileExpired.status === 200 && statusWhileExpired.json?.active === false
  && statusWhileExpired.json?.status === 'trial_expired',
  'billing/status reports the expiry (so the banner can speak)', statusWhileExpired.json?.status);

// --- 4. restore the practice -> cover returns -------------------------------
await setBilling('Airgead Accountancy', 'active', 25);
const restoredWrite = await req('/expenses', {
  method: 'POST', token: client,
  body: { title: 'Cover restored', category: 'feed_bedding', amount: 10, currency: 'EUR' },
});
ok(restoredWrite.status === 201, 'restoring the practice restores the seat');

// --- 5. solo org lifecycle (uses the from-empty smoke user if present) ------
const soloRow = await pool.query("SELECT o.id FROM organisations o WHERE o.name = 'Smoke Farm'");
if (soloRow.rows[0]) {
  const solo = await login('smoke@airgead.dev');
  await setBilling('Smoke Farm', 'none', -3);
  const soloBlocked = await req('/expenses', {
    method: 'POST', token: solo,
    body: { title: 'x', category: 'feed_bedding', amount: 1, currency: 'EUR' },
  });
  ok(soloBlocked.status === 402, 'expired SOLO org blocked on write');
  await setBilling('Smoke Farm', 'active', 25);
  const soloOk = await req('/expenses', {
    method: 'POST', token: solo,
    body: { title: 'subscribed again', category: 'feed_bedding', amount: 1, currency: 'EUR' },
  });
  ok(soloOk.status === 201, 'subscribed solo org writes again');
} else {
  console.log('SKIP  solo lifecycle (no Smoke Farm org — run the from-empty smoke first)');
}

// --- 6. super_admin bypasses the gate ---------------------------------------
const admin = await login('demo@airgead.dev');
await setBilling('Demo Org', 'none', -3);
const adminWrite = await req('/expenses', {
  method: 'POST', token: admin,
  body: { title: 'super admin bypass', category: 'software', amount: 1, currency: 'EUR' },
});
ok(adminWrite.status === 201, 'super_admin writes bypass the billing gate');
await setBilling('Demo Org', 'active', 25);

// --- 7. webhook signature rejection ------------------------------------------
const badSig = await req('/billing/webhook', {
  method: 'POST',
  body: JSON.stringify({ type: 'checkout.session.completed' }),
  headers: { 'stripe-signature': 't=1,v1=deadbeef' },
});
ok(badSig.status === 400, 'webhook with a forged signature is rejected 400', `status ${badSig.status}`);
const noSig = await req('/billing/webhook', { method: 'POST', body: JSON.stringify({}) });
ok(noSig.status === 400, 'webhook without a signature header is rejected 400');

// --- 8. email verification lifecycle -----------------------------------------
const vEmail = `verify-drive-${Date.now()}@airgead.dev`;
const reg = await req('/users/register', {
  method: 'POST',
  body: { fname: 'Verify', sname: 'Drive', email: vEmail, password: 'Password123!', currency: 'EUR' },
});
ok(reg.status === 201, 'self-serve signup succeeds (verification pending)');
const freshLogin = await req('/users/login', { method: 'POST', body: { email: vEmail, password: 'Password123!' } });
ok(freshLogin.status === 200, 'unverified login works INSIDE the 7-day grace');

await pool.query("UPDATE users SET created_at = now() - interval '8 days' WHERE email = $1", [vEmail]);
const graceOver = await req('/users/login', { method: 'POST', body: { email: vEmail, password: 'Password123!' } });
ok(graceOver.status === 403 && graceOver.json?.code === 'email_unverified',
  'unverified login 403s AFTER the grace window', `status ${graceOver.status}`);

const resend = await req('/users/resend-verification', { method: 'POST', body: { email: vEmail } });
ok(resend.status === 200, 'resend-verification answers 200');

const verifyToken = jwt.sign({ email: vEmail, kind: 'verify' }, JWT_SECRET, { expiresIn: '24h' });
const verify = await req(`/users/verify-email?token=${verifyToken}`, { redirect: 'manual' });
ok(verify.status >= 300 && verify.status < 400 && (verify.headers.get('location') || '').includes('verified=1'),
  'verification link stamps and redirects to login?verified=1', verify.headers.get('location'));
const afterVerify = await req('/users/login', { method: 'POST', body: { email: vEmail, password: 'Password123!' } });
ok(afterVerify.status === 200, 'verified account logs in');

const badKind = jwt.sign({ email: vEmail, inviter_id: 'x' }, JWT_SECRET);
const wrongKind = await req(`/users/verify-email?token=${badKind}`, { redirect: 'manual' });
ok((wrongKind.headers.get('location') || '').includes('verified=expired'),
  'a non-verify token cannot verify (redirects to expired)');

// --- 9. restore + cleanup ----------------------------------------------------
await setBilling('Galway Equine', 'active', 25);
await pool.query('DELETE FROM expenses WHERE title IN ($1,$2,$3,$4,$5)',
  ['Covered-seat write', 'Cover restored', 'subscribed again', 'super admin bypass', 'x']);
// The drive user owns an auto-created org; unpick both sides of the FK pair.
await pool.query(
  'UPDATE organisations SET owner_account_id = NULL WHERE owner_account_id = (SELECT id FROM users WHERE email = $1)',
  [vEmail]);
await pool.query('DELETE FROM users WHERE email = $1', [vEmail]);
await pool.query('DELETE FROM organisations WHERE owner_account_id IS NULL AND name = $1', ['Verify Drive']);
await pool.end();

console.log(failures === 0 ? '\nALL PHASE 6 E2E CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
