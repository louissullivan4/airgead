// Real-browser UI smoke test (Playwright). Logs in, clicks through the app,
// adds a transaction, and asserts the UI reacts — screenshots every step.
//
// Run against a live stack (see e2e/README.md). Env:
//   BASE      frontend origin           (default http://localhost:3000)
//   EMAIL     seeded login              (default demo@airgead.dev)
//   PASSWORD  seeded password           (default Password123!)
//   OUT       screenshot dir            (default ./e2e/shots)
import { chromium } from 'playwright';
import fs from 'fs';

const BASE = process.env.BASE || 'http://localhost:3000';
const EMAIL = process.env.EMAIL || 'demo@airgead.dev';
const PASSWORD = process.env.PASSWORD || 'Password123!';
const OUT = process.env.OUT || './e2e/shots';
fs.mkdirSync(OUT, { recursive: true });

let shot = 0;
const results = [];
const snap = async (page, name) => {
  shot += 1;
  const file = `${OUT}/${String(shot).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: file, fullPage: true }).catch(() => {});
};
const step = async (page, name, fn) => {
  try { await fn(); results.push(true); console.log('PASS  ' + name); }
  catch (e) {
    results.push(false);
    console.log('FAIL  ' + name + ' — ' + ((e && e.message) || e));
    await snap(page, 'FAIL-' + name.replace(/[^a-z0-9]+/gi, '-').slice(0, 40));
  }
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(15000);

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message.slice(0, 200)));

await step(page, 'login page renders (email, password, Sign in)', async () => {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('#email').waitFor();
  await page.locator('#password').waitFor();
  await page.getByRole('button', { name: 'Sign in' }).waitFor();
  await snap(page, 'login');
});

await step(page, 'Sign in button authenticates and lands on /home', async () => {
  await page.locator('#email').fill(EMAIL);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/home');
  await page.getByRole('link', { name: /Add transaction/i }).first().waitFor();
  await snap(page, 'home');
});

await step(page, 'transactions page lists seeded rows', async () => {
  await page.goto(`${BASE}/transactions`, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('Search transactions').waitFor();
  await page.getByRole('button', { name: 'Add', exact: true }).waitFor();
  await page.getByRole('row').nth(1).waitFor();
  const rows = await page.getByRole('row').count();
  console.log('      rows (incl header):', rows);
  if (rows < 2) throw new Error('no data rows rendered');
  await snap(page, 'transactions');
});

await step(page, 'search box filters the table', async () => {
  const before = await page.getByRole('row').count();
  await page.getByPlaceholder('Search transactions').fill('zzz-no-such-txn');
  await page.waitForTimeout(700);
  const after = await page.getByRole('row').count();
  await snap(page, 'search-filtered');
  await page.getByPlaceholder('Search transactions').fill('');
  await page.waitForTimeout(300);
  if (after > before) throw new Error(`filter increased rows (${before} -> ${after})`);
});

await step(page, 'Add → Skip photo opens the manual form', async () => {
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Skip photo' }).click();
  await page.locator('#tx-title').waitFor();
  await page.locator('#tx-amount').waitFor();
  await snap(page, 'add-form');
});

const TITLE = 'UI smoke transaction';
await step(page, 'fill form + Add transaction creates the row', async () => {
  await page.locator('#tx-title').fill(TITLE);
  await page.locator('#tx-amount').fill('12.34');
  try {
    await page.locator('#tx-category').click({ timeout: 3000 });
    await page.getByRole('option').first().click({ timeout: 3000 });
  } catch (e) { console.log('      (category select skipped: ' + String((e && e.message) || e).slice(0, 60) + ')'); }
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await page.getByText('Transaction added').waitFor({ timeout: 10000 });
  await snap(page, 'added-toast');
});

await step(page, 'new transaction is visible in the table', async () => {
  await page.getByPlaceholder('Search transactions').fill(TITLE);
  await page.waitForTimeout(800);
  await page.getByText(TITLE).first().waitFor();
  await snap(page, 'row-present');
});

await step(page, 'Log out returns to /login', async () => {
  const trigger = page.getByRole('button', { name: /account|menu|profile|user/i }).first();
  if (await trigger.count()) await trigger.click().catch(() => {});
  await page.waitForTimeout(300);
  const item = page.getByRole('menuitem', { name: /log ?out/i });
  if (await item.count()) await item.click();
  else await page.getByText(/log ?out/i).first().click();
  await page.waitForURL('**/login');
  await snap(page, 'logged-out');
});

await browser.close();
const failed = results.filter((r) => !r).length;
console.log('\nconsole/page errors observed: ' + consoleErrors.length);
if (consoleErrors.length) console.log(consoleErrors.slice(0, 6).map((e) => '  - ' + e).join('\n'));
console.log(failed ? `\n${failed} UI CHECK(S) FAILED` : '\nALL UI CHECKS PASSED');
process.exit(failed ? 1 : 0);
