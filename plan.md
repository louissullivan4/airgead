Phase 1 Implementation Spec — UI Rework: Carbon PWA, Purple Theme, Four Screens
Depends on: Phase 0 (private storage, org_id in JWT, tenant scoping). The API contract Phase 0 produces is what Phase 1 consumes.
Goal: Replace the current multi-screen native UI with a simplified, installable web app on Carbon Design with a purple primary, structured as four screens: Home, Transactions, Settings, plus auth. No new backend features — this is presentation + consolidation.

New web/ app (or new repo): Next.js (App Router) + TypeScript + @carbon/react + Sass.
PWA setup: manifest.json (name = the new brand from Phase 0's Task 0, theme color = your purple, display: standalone, icons), a service worker for the offline app shell, installability criteria met.
Auth wiring to the existing Express API: login/signup pages hitting /users/login and /users/signup; store JWT (httpOnly cookie preferred over localStorage for a financial app); attach Authorization: Bearer to API calls; handle the Phase 0 "token missing orgId → 401 re-login" case by redirecting to login.
API base URL from env (the stable custom domain you set up in Phase 0 Task 0.2, not the raw Cloud Run URL).
Route guard: unauthenticated users → login; authenticated → app shell with the four-screen nav.

Task 2 — Purple theme via Carbon tokens

Create src/styles/theme.scss as the single styling entrypoint.
Override the theme using the Sass with (...) mechanism. Set the interactive/brand tokens to your purple ramp. Carbon's own palette already includes purple-60 ≈ #8a3ffc, which is a safe, accessibility-tested anchor — use the Carbon purple ramp values rather than hand-picked hexes so contrast ratios stay AA-compliant.
Override at minimum: $interactive, $link-primary, $focus, and the button component tokens ($button-primary, $button-primary-hover, $button-primary-active) — the search confirmed buttons need their own component-token override, not just the global theme token, or primary buttons stay blue.
Provide per-theme value maps (White / Gray 10 light, Gray 90 / 100 dark) so dark mode works if you enable it. Don't ship dark mode in Phase 1 unless trivial; just leave the maps stubbed.
One brand constant module re-exporting the name + primary hex, consumed by manifest, emails, and UI (consistent with Phase 0 Task 0.1's single-source-of-truth rule).

Task 3 — Home screen
Consolidates the current Homescreen + HomeCard + ContactCard.

Stat tiles (Carbon Tile / ClickableTile): current tax-year expenses total, income total, net, and receipts pending review (the receipt_status='pending' count once Phase 2 lands; until then, total receipts). Pull from existing /expenses/users/:id/:year.
Category breakdown chart: @carbon/charts-react donut or simple bar by category. Note @carbon/charts-react is a separate install with its own peer deps — call it out so Claude Code adds it explicitly.
Recent activity: last N transactions as a compact list, each linking into the Transactions screen.
Contact/support entry point: fold the old ContactCard into a small support link/section rather than its own card.
All numbers respect the selected currency from the user's profile.

Task 4 — Transactions screen (the big consolidation)
Replaces Expensescreen, Incomescreen, CreateExpenseScreen, CreateIncomeScreen, ExpenseList, and the native swipe actions — five screens collapse into one.

Single Carbon DataTable of all transactions.
Filter for All / Expenses / Income (income is category='income' per the current model; the existing getExpensesByUserIdNoIncome and category logic back this).
TableToolbar: search, the type filter, and an Export button (wired to the existing Excel/zip endpoints; CSV/Sage come in later phases — Export can be present but offer only what exists now).
Add button: opens a Modal (or side panel) with the create form. In Phase 2 this button's behaviour changes to camera-first, so isolate the "open add flow" handler now so Phase 2 swaps it cleanly.
Row actions via OverflowMenu: Edit (same modal, pre-filled), Delete (with a confirm Modal — replaces the old swipe-to-delete Alert).
Receipt thumbnail per row: fetch via the Phase 0 signed-URL endpoint, not a stored public URL.
Pagination + sort via DataTable's built-ins; default sort by date desc (matches current ORDER BY updated_at DESC).
The create/edit form fields map exactly to the current expenses columns (title, description, category, amount, currency, receipt image) so no API change is needed.

Task 5 — Settings screen
Consolidates ProfileScreen + ProfileCard + logout.

Profile view/edit (maps to existing /users/:id PATCH).
Currency preference.
Subscription/tier display (read-only in Phase 1; becomes interactive in Phase 4).
Data-retention notice placeholder ("records retained until…" — populated in Phase 3).
Logout (replaces LogoutButton).
For business/accountant orgs, a stub entry point to client management (built in Phase 6) — show it only if orgRole='owner' on a business org; hide for personal orgs. This uses the Phase 0 role axes already in the JWT.

Task 6 — Navigation, retire old screens, tidy

App-shell nav: Carbon SideNav (desktop) / bottom nav or header menu (mobile-width), four destinations: Home, Transactions, Settings, + support.
Retire the Expo screens listed above. If keeping the Expo repo (Path B not chosen), mark it deprecated; if abandoning native, archive it.
Responsive: this is a phone-first browser app, so verify the DataTable and tiles collapse cleanly at mobile widths (Carbon's grid + responsive DataTable behaviours).
Loading/empty/error states for every screen (Carbon SkeletonText, InlineNotification).

Deliverables checklist

 Next.js + @carbon/react + Sass scaffold, PWA manifest + service worker, installable
 theme.scss purple override (global tokens and button component tokens), brand constant module
 Home (tiles + @carbon/charts-react + recent activity)
 Transactions (single DataTable, filter, toolbar+export, add/edit modal, overflow row actions, signed-URL thumbnails)
 Settings (profile, currency, tier read-only, retention placeholder, conditional client-mgmt stub)
 Auth pages + route guard + orgId-missing → re-login handling
 Old Expo screens retired/deprecated
 Responsive + loading/empty/error states throughout