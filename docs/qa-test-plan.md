# airgead — Full QA Test Plan

Every user-facing flow, organised by persona. Work through one suite at a time, tick each case, and log anything that deviates from **Expected**. Cases are numbered (A1, B3…) so bugs can reference them.

> Sections marked **[needs config]** require extra setup (Stripe test keys, Sage sandbox, SMTP, or flag changes) — everything else runs on the default dev stack.

---

## 1. Environment setup

```bash
cp backend/.env.example backend/.env          # defaults are fine for the base pass
cp frontend/.env.local.example frontend/.env.local
docker compose up                             # frontend :3000, backend :8080, postgres :5432
npm run seed                                  # loads the personas below (idempotent, re-run any time)
```

- Emails (invites, verification, password reset) only send if `SMTP_*` is configured in `backend/.env`. Without SMTP, email-dependent cases will error on send — either configure a test inbox or pull tokens from the backend logs / DB.
- Rate limiters are **disabled when `NODE_ENV=test`** — run the base pass with `NODE_ENV=development` or the 429 cases can't fire.
- Seeded orgs are pre-set to `billing_status='active'` so the billing gate never trips accidentally; Suite K includes the SQL to force other states.

### Test accounts (all passwords: `Password123!`)

| Persona | Login | What they are |
|---|---|---|
| **P7 Super admin** (also a solo personal user) | `demo@airgead.dev` | Personal org "Demo Org", `platform_role=super_admin`, 12 seeded transactions |
| **P4 Firm admin** | `accountant@airgead.dev` | Owner of practice "Airgead Accountancy" (`is_accountant_practice`), sees BOTH clients |
| **P5 Staff accountant** | `accountant2@airgead.dev` | Member of the same firm, owns only the Murphy Retail client link |
| **P6a Client (farmer)** | `client1@airgead.dev` | Owner of "Galway Equine" (sole_trader_equine, `vat_status=flat_rate_farmer`, has a capital asset). Link owned by the firm admin |
| **P6b Client (retail)** | `client2@airgead.dev` | Owner of "Murphy Retail" (retail, `vat_status=registered`). Link owned by the staff accountant |

Personas without seed accounts — create during Suite B: **P1 solo trader** (fresh "Just me" signup), **P2 business owner** (signup with org details), **P3 org member** (member invite).

### Feature flags (defaults in parentheses)

| Flag | Where | Governs |
|---|---|---|
| `BILLING_ENFORCED` (`true` in .env.example; seed orgs are active so nothing blocks) | backend | 402 write-gate + trial banner + billing card states — Suite K |
| `STRIPE_SECRET_KEY` etc. (empty) | backend | Checkout/portal buttons; empty ⇒ billing routes 502 "not configured" |
| `REQUIRE_EMAIL_VERIFICATION` (`true`) | backend | 7-day grace then login 403 — Suite C |
| `SAGE_ENABLED` (`false`) + `SAGE_CLIENT_ID/SECRET`, `TOKEN_ENCRYPTION_KEY` | backend | /sage routes exist; inert without creds — Suite L |
| `NEXT_PUBLIC_SAGE_ENABLED` (`false`) | frontend (build-time) | Sage UI renders — Suite L |
| `OCR_PROVIDER` (`none`) + `NEXT_PUBLIC_OCR_AUTOFILL_ENABLED` (`false`) | both | Receipt auto-fill — Suite M |

### Useful constants (assert against these)

- Session cookie `airgead_token`: httpOnly, 7-day TTL. JWT also 7 days.
- Login/register/reset/resend rate limit: **10 per 15 min per IP** → 429. Global: 300/15 min.
- Email verification link: **24 h**; grace before login lockout: **7 days**. Password-reset token: **1 h**. All invite tokens: **7 days**.
- Receipt signed URLs: **5 min** TTL. Stored receipt: auto-oriented, max 2200px, JPEG q85.
- Clients "Gone quiet" badge: **> 60 days** since last record. Client stats: current calendar year only.
- Trial: **30 days**. Wear & tear: **12.5 %/yr over 8 years**, €24k passenger-car cap.

---

## 2. Personas at a glance

| # | Persona | Nav they should see |
|---|---|---|
| P0 | Unauthenticated visitor | Landing, login, signup, forgot-password, offline only |
| P1 | Solo trader (personal org owner) | Home, Transactions, Settings |
| P2 | Business owner (business org owner) | Home, Transactions, **Tax summary**, **Team**, Settings |
| P3 | Org member (invited into P2's org) | Home, Transactions, Tax summary*, Settings (org fields read-only) — *link shows for business orgs; data is org-wide |
| P4 | Accountant firm admin (practice owner) | Everything P2 has + **Clients** |
| P5 | Staff accountant (practice member) | Home, Transactions, Tax summary, **Clients** (own clients only), Settings |
| P6 | Client of a practice | Same as P1/P2 (they own a normal org) — plus an accountant sees their data |
| P7 | Super admin | Everything + **Admin**; bypasses org-role, link, and billing gates |

---

## Suite A — Public pages & route guard (P0)

| # | Steps | Expected |
|---|---|---|
| A1 | Open `/` logged out | Landing renders. Header: "For accountants" → `/signup`, "Pricing" → `/pricing`, "Log in", "Start free". Footer links to pricing/terms/privacy/login |
| A2 | Open `/login`, `/signup`, `/forgot-password`, `/offline` logged out | All render (public) |
| A3 | Open `/home` (or any app URL) logged out | Redirect to `/login` |
| A4 | Open `/pricing`, `/terms`, `/privacy` logged out | **Currently redirects to `/login`** — known issue #5 (§Known issues): legal/pricing pages aren't in the public path list. Log it if not yet fixed; also note the signup consent links open these in a new tab and bounce |
| A5 | Log in, then open `/` or `/login` | Redirect to `/home` |
| A6 | `/health` on the backend (`curl localhost:8080/health`) | 200, no auth needed |

## Suite B — Signup & onboarding

**B1–B4 self-serve variants** (use fresh emails; these create P1/P2 personas):

| # | Steps | Expected |
|---|---|---|
| B1 | `/signup`: fill first/surname/email/password, leave "Set up your organisation" collapsed, tick consent, submit | Lands on `/home`. Personal org auto-named "Fname Sname", nav shows only Home/Transactions/Settings (P1). Currency EUR |
| B2 | Same but submit **without** ticking consent | Button disabled; if forced, error "Please agree to the Terms of Service and Privacy Policy to continue." |
| B3 | Expand "Add details": org name "QA Bakery", type Hospitality, country IE, VAT number | Business org created; nav now includes Tax summary + Team (P2). Settings → Organisation shows the entered values |
| B4 | Expand "Add details", tick **"This is an accountancy practice"**, name the org, submit | New firm: Clients appears in nav; Team page says "Accountants" |
| B5 | Repeat B4 but leave org name **blank** | **Known issue #3**: practice checkbox silently ignored — user gets a personal org, no Clients nav. Log if unfixed |
| B6 | Sign up with an email that already exists | 400 "User with this email already exists." shown inline |
| B7 | Sign up with a 1-character password | **Currently accepted** (no strength rules — known issue #2). Verify hint text says "At least 8 characters" but nothing enforces it |

**B8–B11 invite signups** (need SMTP or token from logs; all invite links = `/signup?token=…`, valid 7 days, invitee auto-verified, org section hidden on the signup page):

| # | Steps | Expected |
|---|---|---|
| B8 | As P2 owner: Team → Invite, enter fresh email. Open the link, sign up | New user joins P2's org as **member** (P3). No new org. Team lists them |
| B9 | As P4 (`accountant@airgead.dev`): Clients → Invite client, fresh email. Open link, sign up | Invitee gets their **own org** (owner) + appears on the firm's Clients list, owned by the inviter. This is a new P6 |
| B10 | As P7: Admin → Invite, kind **user** / then kind **accountant** | "user" invitee gets a plain own org; "accountant" invitee's org is a practice (Clients nav) |
| B11 | Open any invite link, sign up with a **different** email than invited | 400 "Invite is for a different email address." |

## Suite C — Login, session, verification, password reset

| # | Steps | Expected |
|---|---|---|
| C1 | Login with wrong password / unknown email | 401 "Invalid email or password." (same message both cases) |
| C2 | Login with a seeded account | Lands `/home`. Cookie `airgead_token` set (httpOnly, 7d) |
| C3 | 11 login attempts in 15 min from one IP (`NODE_ENV` ≠ test) | 11th → 429 "Too many attempts - please wait 15 minutes and try again." |
| C4 | Log out from Settings → Account | Cookie cleared, back on `/login`, app URLs redirect to login |
| C5 | Tamper the cookie value in devtools, then navigate | Backend 401 → cookie deleted → bounced to `/login` |
| C6 | Fresh self-serve signup: check app shell | Amber "Please verify your email" banner with Resend button (self-serve users start unverified; 7-day grace) |
| C7 | Verify via the emailed link (`/users/verify-email?token=`) | Redirect to `/login?verified=1` → toast "Email verified…". Banner gone after login |
| C8 | Backdate the user: `UPDATE users SET created_at = now() - interval '8 days' WHERE email='<fresh>'`, log out, log in | 403 "Please verify your email address to continue…" + login page shows "Send a new verification link" button |
| C9 | Use the resend button / `POST /users/resend-verification` with any email | Always 200 "If that address needs verification, a new link is on its way." (no user enumeration) |
| C10 | Open an **expired/invalid** verification link | Redirect `/login?verified=expired` → error text prompting a new link |
| C11 | `/forgot-password` with a seeded email | Success screen "If an account exists for {email}, a reset link is on its way." |
| C12 | `/forgot-password` with an unknown email | **Known issue #4**: shows "User not found." (enumeration leak). Log if unfixed |
| C13 | Open the emailed reset link `/reset-password?token=…` | **Known issue #1**: page does not exist → 404. The backend endpoint works but has no UI. Log if unfixed |

## Suite D — Core capture & transactions (run as P1; spot-check as P6a which has seed data)

| # | Steps | Expected |
|---|---|---|
| D1 | `/home` on a fresh account | Stat cards all €0.00 / 0; "No expenses recorded for {year} yet."; "No transactions yet" empty state with Add button |
| D2 | Add → **camera dialog** appears; click "Take a photo" on desktop | File picker opens (mobile: camera). Pick a receipt photo → spinner "Cleaning up receipt…" (dialog can't be closed) → form opens in **Receipt mode** with thumbnail |
| D3 | Receipt mode: set merchant, add 2 line items (category + amount each), save | Toast "2 items added". Two rows appear sharing one receipt icon. Home Receipts counter: see known issue #7 (captured receipts don't increment it) |
| D4 | Receipt mode: try saving a line without category or with amount 0 | Toast "Each line needs a category and a non-zero amount." |
| D5 | Add → **Skip photo** | Blank single form. Save an expense (title, category, amount, date) → row appears |
| D6 | Add an **Income** entry (type toggle) | No category/capital UI; renders green `+` amount; Home Income card updates |
| D7 | Missing title or zero amount in single mode | Toast "Add a title and a non-zero amount." |
| D8 | Backdate a transaction to last year via the Date field | It disappears from Home (current-year scope) but stays in Transactions (all years); sorts correctly |
| D9 | Table: type filter, search (partial title/category/description), column sorts, page size 10/25/50, pagination bounds | All client-side behaviours work; filtered-empty state shows "No matching transactions" |
| D10 | Edit a row via kebab → change amount | Row updates, toast |
| D11 | Delete via kebab → confirm dialog | "This can't be undone" dialog; row gone after confirm; page clamps if last row on page |
| D12 | Receipt thumbnail click | Full image opens in new tab (signed URL). Re-open after >5 min idle: link in old tab expires (403 from storage), re-rendered thumb re-signs |
| D13 | **Capital toggle**: add expense with category "Equipment" (or any capital-flagged) | Toggle pre-ticks; Asset type select appears. After save: **Capital chip** on the row; asset on `/reports` register as "From transaction" |
| D14 | Edit that expense, untick Capital | Chip gone; asset removed from register; transaction remains |
| D15 | Header **Export** | Downloads `transactions_{year}.zip` (xlsx + images/). On a no-data year: toast shows generic "Not Found" — known issue #6 |
| D16 | Categories select in the form | Shows the org's tree (groups + indented children). For P6a expect the equine template |

## Suite E — Business-owner extras (run as P2 or P6b)

| # | Steps | Expected |
|---|---|---|
| E1 | Settings → Profile: change name, phone, address, currency → Save | Toast "Settings saved"; currency reflected on amounts. Email field read-only |
| E2 | Settings → Organisation (as owner): change name, business type, description, country, VAT status | Saves; VAT number field only visible when country = IE |
| E3 | Settings → Categories (owner): add a category + a subcategory, rename one, delete one, Save | Tree persists; renamed category still resolves on old transactions (slug preserved). Reset-to-defaults restores template |
| E4 | `/reports` year picker | Current + 8 prior years |
| E5 | Reports stat cards vs Form 11 table | "Total allowable expenses" footer equals the Allowable expenses card; capital expenses are **excluded** from both (they're in Capital allowances) |
| E6 | Capital allowances schedule (P6a has the €8,400 horsebox) | 12.5 %/yr straight line, "Year N of 8", Opening/Allowance/Closing WDV consistent |
| E7 | Asset register: Add opening asset (description, type, cost, date) | Appears with "Opening asset" badge; enters the schedule |
| E8 | Edit → dispose (checkbox → disposal date + proceeds) | "Disposed" badge; allowance stops from disposal year |
| E9 | Remove from register (one with a linked transaction) | Confirm dialog notes the transaction stays as a normal expense |
| E10 | VAT section per `vat_status`: not_registered / registered (P6b) / flat_rate_farmer (P6a) | Registered → "Reclaimable via VAT returns: Yes"; farmer → flat-rate addition row (5.1 % for 2025+); VAT 58 note only for non-registered orgs with eligible spend |
| E11 | Team (owner): invite member, view roster | Table Name/Email/Role; invite sends (see B8) |
| E12 | Home receipts/pending counters and category chart with seeded data (P6a/P6b) | Non-income only in chart, shares sum to 100 % |

## Suite F — Org member restrictions (run as P3 from B8)

| # | Steps | Expected |
|---|---|---|
| F1 | Nav | No Team link (owner-only). Tax summary visible (business org) |
| F2 | Settings → Organisation | All fields disabled, "Only the owner can edit these.", no Save button |
| F3 | Settings → Categories | Read-only; no add/delete/save/reset controls |
| F4 | Direct API: `PATCH /organisations/:id` as member (devtools fetch via proxy) | 403 |
| F5 | Navigate directly to `/team` | "Failed to load team" destructive card (backend 403) |
| F6 | Member adds transactions | Works; owner sees org-wide rollup (member data counts toward org totals/tax summary) |

## Suite G — Accountant firm admin (P4: `accountant@airgead.dev`)

| # | Steps | Expected |
|---|---|---|
| G1 | `/clients` list | BOTH clients (Galway Equine, Murphy Retail) + **Accountant column** (owner names) + readiness badges + current-year stats |
| G2 | Readiness badges | Client with no txns this year → red "No records"; last activity > 60 days → amber "Gone quiet"; else green "Up to date" |
| G3 | Search box | Matches name or category label; empty → "No matching clients" |
| G4 | Open a client → detail page | "Viewing {name} · read-only" bar; Transactions tab with filter/sort/pagination; no edit/delete controls anywhere |
| G5 | Client detail → Tax summary tab + year picker | Loads the client's summary; year change refetches |
| G6 | Export (list row or detail) | Downloads zip: `transactions_{year}.xlsx` (Expenses sheet + Tax summary + Capital allowances + VAT sheets, Capital column, embedded images) + `images/` |
| G7 | Export a client with no transactions this year | Toast error (404 path) |
| G8 | Invite client (fresh email) → complete signup | New client org appears in list, owned by P4 (Accountant column) |
| G9 | **Reassign** (row menu, admin only) → pick the staff accountant | Success toast; Accountant column updates; P5 can now see it |
| G10 | **Revoke access** on a test client → confirm | Client disappears from list. Their login/data unaffected (verify by logging in as them). Re-invite works afterwards |
| G11 | `/team` | Heading "Accountants", firm copy; invite adds a staff accountant (member) |
| G12 | Sage entry points visible only when Sage flags on | See Suite L |

## Suite H — Staff accountant scoping (P5: `accountant2@airgead.dev`)

| # | Steps | Expected |
|---|---|---|
| H1 | `/clients` | ONLY Murphy Retail. No Accountant column, no Reassign menu item |
| H2 | Navigate directly to `/clients/<galway-equine-org-id>` (grab id from P4's session or DB) | Destructive card "Access denied. You do not manage this client." — no data leaks, no redirect |
| H3 | Direct API `PATCH /accountant/clients/<id>/assign` | 403 (owner-only) |
| H4 | Direct API export of the other client (`GET /accountant/clients/<id>/export`) | 403 |
| H5 | Invite a client themselves | Allowed; new client is owned by P5 (visible to them and to the admin) |
| H6 | Revoke their **own** client | Allowed. (Admin can revoke any) |
| H7 | No Team nav (they're an org member) | Correct |

## Suite I — Client of a practice (P6a/P6b)

| # | Steps | Expected |
|---|---|---|
| I1 | Log in as `client1@airgead.dev` | Normal business-owner experience (Suite D/E apply). No Clients nav, no sign their accountant exists |
| I2 | Add a transaction as the client | P4 sees it on the client detail page (fresh load) and in stats |
| I3 | After the practice revokes the link (G10) | Client unaffected: same login, data, features |

## Suite J — Super admin (P7: `demo@airgead.dev`)

| # | Steps | Expected |
|---|---|---|
| J1 | Nav includes **Admin**; `/admin` renders | 4 stat cards (Organisations, Users, Firms + linked clients, Net this year) |
| J2 | Orgs table | All orgs, member counts, year stats, status. Own org row: only "Open" (no suspend/delete) |
| J3 | Users table | All users with org, platform pill. Own row: no actions menu |
| J4 | Grant super admin to a test user → verify → revoke | PATCH works; target sees Admin nav on next login. Attempting on own id → 400 |
| J5 | **Suspend a user** → they log out & retry login | 403 "This account has been suspended." — **but an existing session keeps working until the 7-day token expires (known behaviour #8)** |
| J6 | **Suspend an org** → its members' fresh logins | 403 "This organisation has been suspended." Same live-session caveat |
| J7 | GDPR delete: a member user | User + their expenses/receipts gone; org survives; any client links they created lose their owner (firm admin still sees the client) |
| J8 | GDPR delete: a user who solely owns an org | Cascades the whole org. If the org has other members → 409 "…Delete the organisation or reassign ownership first." |
| J9 | Delete an org (not your own) | Cascade removes links/users/data. Own org → 400 |
| J10 | Bypass checks: open `/clients/<any-org-id>` as P7 | Works even for non-linked orgs (falls back to org name); exports work; billing gate never blocks P7 |

## Suite K — Billing enforced **[needs config: `BILLING_ENFORCED=true`; Stripe test keys for checkout cases]**

Restart backend with `BILLING_ENFORCED=true`. Create a fresh solo signup (it gets a 30-day trial). Force states via SQL where noted.

| # | Steps | Expected |
|---|---|---|
| K1 | Fresh trial user, >7 days left | No banner. Billing card: "Trial" badge, days left |
| K2 | `UPDATE organisations SET trial_ends_at = now() + interval '3 days' WHERE id='<org>'` | Amber banner "Your free trial ends in 3 days." |
| K3 | `UPDATE organisations SET trial_ends_at = now() - interval '1 day' WHERE id='<org>'` | Destructive banner "Your trial has ended…". **Writes blocked**: add/edit/delete transaction, receipt capture, asset ops → toast "Your trial has ended. Subscribe to keep adding records…" (402). **Reads fine**: Home, lists, Reports, Export zip, receipt images |
| K4 | Billing card without Stripe keys (owner) | "Online payment isn't available yet - contact support to subscribe."; no working buttons |
| K5 | With Stripe test keys: Subscribe → Stripe Checkout → complete with `4242…` | Return to `/settings?billing=success` toast; after webhook, card shows "Active"; writes unblocked |
| K6 | Client of a **paying** practice (mark the seeded practice: `UPDATE organisations SET billing_status='active', stripe_subscription_id='sub_test' WHERE name='Airgead Accountancy'`) | Client's billing card: "Covered" — "Your seat is covered by your accountant's practice"; no subscribe button; writes work |
| K7 | Revoke that client's link | Entitlement drops to their own trial/expired immediately |
| K8 | Practice's own card | "Practice" badge, seat count line, per-seat copy; practice itself never blocked |
| K9 | Seat sync (Stripe configured + subscribed practice): invite client / revoke client | Subscription quantity +1 / −1 (check Stripe dashboard); reassign → unchanged |
| K10 | Non-owner (P3) views billing card | State copy only, "Only the owner can change billing.", no buttons |
| K11 | `/pricing` page | Solo €9/mo, Practice €7/seat/mo, 30-day-trial + read-only-on-lapse copy |

## Suite L — Sage integration **[needs config; full OAuth needs a Sage developer sandbox]**

**L1–L3 flag off (default):** nothing exists.

| # | Steps | Expected |
|---|---|---|
| L1 | Default env: `curl localhost:8080/sage/status` | 404. No Sage card in Settings, no "Export to Sage" anywhere |
| L2 | Set only `NEXT_PUBLIC_SAGE_ENABLED=true` (rebuild frontend), backend flag still off | Menu items may render but Settings card hides itself (status 404) — no broken card |
| L3 | Existing zip/csv exports | Unaffected in all Sage configurations |

**L4–L7 flag on, unconfigured** (`SAGE_ENABLED=true`, no creds):

| # | Steps | Expected |
|---|---|---|
| L4 | Backend boot log | Warnings: missing SAGE_CLIENT_ID/SECRET + missing TOKEN_ENCRYPTION_KEY |
| L5 | As P4: Settings → Sage card | Card visible (practice only — P1/P2/P6 never see it) with "Sage isn't configured on this server yet" note |
| L6 | As P4: Clients → row menu → Export to Sage | Dialog: "Link your Sage account in Settings first" (practice not connected) |
| L7 | Direct API `POST /sage/connect` (owner) | 502 "Sage is not configured on this server." |

**L8–L16 fully configured** (`SAGE_CLIENT_ID/SECRET` from developer.sage.com, `TOKEN_ENCRYPTION_KEY` = `openssl rand -hex 32`, app redirect URI = `{PUBLIC_BACKEND_URL}/sage/callback`, Sage sandbox business):

| # | Steps | Expected |
|---|---|---|
| L8 | P4 (owner) Settings → **Connect Sage** | Full-page redirect to Sage consent → back to `/settings?sage=connected` → toast, card shows "Connected" badge + date |
| L9 | Deny consent at Sage | Return with toast "Sage connection was declined - nothing was linked."; still Not connected |
| L10 | Non-owner accountant (P5) views the card | Status visible, "Only the owner can manage the Sage connection.", no connect/disconnect buttons. Direct `POST /sage/connect` as P5 → 403 |
| L11 | P4: Clients → Export to Sage on Galway Equine | Dialog loads businesses; picking one loads bank accounts / ledger accounts / tax rates; Export enabled only when business+bank+both ledgers chosen |
| L12 | Run the export | Progress → summary "N created, 0 already in Sage, 0 failed". In the Sage sandbox: expenses = **Other Payments**, income = **Other Receipts**, references `airgead:<expense-id>`, capital items suffixed "[Capital]" |
| L13 | Re-run the same export | All rows "already in Sage (skipped)", 0 created |
| L14 | Reopen the dialog later | Business/bank/ledger selections prefilled (remembered per client) |
| L15 | P5 exports **their** client (Murphy Retail) using the org connection | Works. P5 exporting the other client → 403 |
| L16 | Disconnect (owner, confirm dialog) → try an export | Dialog reverts to "Link your Sage account in Settings first" / export 409 |
| L17 | Token expiry resilience: wait >5 min after connecting, then export | Silent refresh (no user-visible error). If the refresh token is revoked at Sage: card shows "Reconnect needed" and exports 409 with reconnect message |

## Suite M — OCR auto-fill (dormant) **[needs config: `OCR_PROVIDER=mock` + `NEXT_PUBLIC_OCR_AUTOFILL_ENABLED=true`, rebuild frontend]**

| # | Steps | Expected |
|---|---|---|
| M1 | Default flags: capture a receipt | Form opens blank (one empty line); **no** confidence indicators anywhere |
| M2 | Flags on: capture a receipt | Form prefills merchant/currency/line items from mock data; amber "Low confidence - please check" on fields with confidence < 0.7 |
| M3 | Stored image in both modes | Always the legible JPEG (never a binarised black/white copy) |

## Suite N — PWA & offline

| # | Steps | Expected |
|---|---|---|
| N1 | Chrome/Android: user menu → "Install app" | Native install prompt; item hidden once installed / on iOS |
| N2 | Installed app opens at `/home`, standalone (no browser chrome) | Per manifest |
| N3 | App shortcut "Add expense" | Opens `/transactions?add=1` → camera dialog |
| N4 | Go offline, navigate to an uncached route | `/offline` page ("You're offline") with Try again |

## Suite O — Security spot checks (any technical QA)

| # | Steps | Expected |
|---|---|---|
| O1 | Tenant isolation: as P1, request another org's data (`GET /expenses/users/<other-user-id>` etc. via proxy) | 403 — never another org's rows |
| O2 | Signed file URL: alter one character of a `/files/<token>` URL | 403 "Invalid or expired link." Wait >5 min → 403. Valid tokens are bearer-usable by design (5-min window) |
| O3 | Receipt object keys | Org-namespaced `org_<id>/<year>/…` (check storage dir / bucket) |
| O4 | Expired/garbage JWT on any API call | 401 + cookie cleared + redirect to login (403 for a bad signature — no redirect) |
| O5 | Member/role escalations: every owner-only endpoint hit as member (org update, invite-member, members list, billing sessions, reassign, sage connect/disconnect) | 403 each |
| O6 | Sage OAuth state: call `GET /sage/callback?code=x&state=<garbage>` (flag on) | Redirects to settings with `sage=error&reason=state`; no token exchange attempted |
| O7 | 429s: 11 rapid register attempts | 429 with the strict-limiter message |

---

## Known issues (log as pre-existing; verify status before filing duplicates)

1. **`/reset-password` page missing** — the emailed reset link 404s; backend endpoint exists but has no UI (C13).
2. **No password rules enforced** — 1-char passwords accepted at signup and reset (B7).
3. **Practice checkbox ignored when org name blank** at signup — user silently gets a personal org (B5).
4. **Forgot-password reveals account existence** — "User not found." for unknown emails; resend-verification is enumeration-safe by contrast (C12).
5. **`/pricing`, `/terms`, `/privacy` blocked for logged-out visitors** — middleware only allows `/`, auth paths, `/offline` (A4).
6. **Export "no data" toast shows generic "Not Found"** — backend sends `{message}` but the client only reads `{error}` (D15, G7).
7. **Home "Receipts" stat undercounts** — camera-captured receipts (receipt_id on the expense, `receipt_image_url` null) don't increment it; only legacy uploads do (D3).
8. **Suspension doesn't kill live sessions** — enforced at login only; a suspended user's existing 7-day token keeps working (J5/J6).
9. **"For accountants" landing link** goes to plain `/signup`, not a dedicated page (A1) — confirm this is intended.
10. **Winston boot warnings print `%s` un-interpolated** in `Env check:` lines — cosmetic, but hides which env var the warning is about (L4).
