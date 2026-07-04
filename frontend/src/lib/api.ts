// API client for the airgead web app.
//
// Auth is handled by a Next.js BFF: the JWT lives in an httpOnly cookie that the
// browser never reads. All backend calls go same-origin through `/api/proxy/*`
// (see src/app/api/proxy/[...path]/route.ts), which attaches the Bearer token
// server-side. Auth lifecycle (login/register/logout/session) uses the dedicated
// `/api/auth/*` route handlers.

const PROXY = "/api/proxy";

/** Thrown by the API client so callers can show `err.message` (and branch on `err.code`). */
export class ApiError extends Error {
  status: number;
  /** Machine-readable code from the backend (e.g. 'email_unverified', 'subscription_required'). */
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function parseError(res: Response): Promise<{ message: string; code?: string }> {
  const body = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
  return { message: body?.error ?? res.statusText ?? "Request failed", code: body?.code };
}

// A 401 from the proxy means the session is gone (logged out, expired, or the
// Phase 0 "token missing orgId" case). Bounce to login from the browser.
function handleUnauthorized(status: number) {
  if (status === 401 && typeof window !== "undefined") {
    window.location.assign("/login");
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${PROXY}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    handleUnauthorized(res.status);
    const { message, code } = await parseError(res);
    throw new ApiError(message, res.status, code);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Fetch an authenticated binary response (e.g. the export ZIP) as a Blob. */
async function requestBlob(path: string): Promise<Blob> {
  const res = await fetch(`${PROXY}${path}`);
  if (!res.ok) {
    handleUnauthorized(res.status);
    const { message, code } = await parseError(res);
    throw new ApiError(message, res.status, code);
  }
  return res.blob();
}

/** POST/GET against the local auth route handlers (not the backend proxy). */
async function auth<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/auth/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const { message, code } = await parseError(res);
    throw new ApiError(message, res.status, code);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  auth: {
    login: (email: string, password: string) =>
      auth<AuthUser>("login", { email, password }),
    register: (data: RegisterData) => auth<AuthUser>("register", data),
    logout: () => auth<void>("logout", {}),
    /** Decoded JWT claims for the current session, or null if not logged in. */
    session: () => auth<Session | null>("session"),
  },
  users: {
    getById: (id: string) => request<UserProfile>(`/users/${id}`),
    update: (id: string, data: Partial<UserProfile>) =>
      request<UserProfile>(`/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    requestPasswordReset: (email: string) =>
      request<void>("/users/request-password-reset", {
        method: "POST",
        body: JSON.stringify({ email }),
      }),
    /** Re-send the email-verification link (rate-limited; never confirms account existence). */
    resendVerification: (email: string) =>
      request<void>("/users/resend-verification", {
        method: "POST",
        body: JSON.stringify({ email }),
      }),
    support: (data: SupportData) =>
      request<void>("/users/support", {
        method: "POST",
        body: JSON.stringify(data),
      }),
  },
  expenses: {
    getByUserId: (id: string) => request<Expense[]>(`/expenses/users/${id}`),
    getByUserIdNoIncome: (id: string) =>
      request<Expense[]>(`/expenses/users/income/${id}`),
    getByUserIdAndYear: (id: string, year: string | number) =>
      request<Expense[]>(`/expenses/users/${id}/${year}`),
    create: (data: CreateExpenseData) =>
      request<Expense>("/expenses", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    update: (id: string, data: UpdateExpenseData) =>
      request<Expense>(`/expenses/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      request<void>(`/expenses/${id}`, { method: "DELETE" }),
    /** Short-lived (5 min) signed URL for the receipt image, or throws 404. */
    getReceiptUrl: (id: string) =>
      request<{ url: string }>(`/expenses/${id}/receipt-url`),
    /** Authenticated ZIP download (Excel + receipt images) for a tax year. */
    downloadZip: (id: string, year: string | number) =>
      requestBlob(`/expenses/downloads/${id}/${year}`),
  },
  receipts: {
    /** Clean + store a captured image; returns the receipt id + signed image URL. */
    process: (imageDataUrl: string) =>
      request<ReceiptProcessResult>("/receipts/process", {
        method: "POST",
        body: JSON.stringify({ image: imageDataUrl }),
      }),
    /** Create one or more expense line items linked to a receipt. */
    createExpenses: (receiptId: string, items: ReceiptLineItemInput[]) =>
      request<Expense[]>(`/receipts/${receiptId}/expenses`, {
        method: "POST",
        body: JSON.stringify({ items }),
      }),
    /** Fresh short-lived signed URL for the receipt image. */
    getImageUrl: (receiptId: string) =>
      request<{ url: string }>(`/receipts/${receiptId}/image-url`),
    /** Receipt plus its linked expense line items. */
    get: (receiptId: string) =>
      request<Receipt & { expenses: Expense[] }>(`/receipts/${receiptId}`),
  },
  // Phase 5 asset register (capital items → wear & tear over 8 years).
  assets: {
    /** The caller org's register + the computed allowance schedule for a year. */
    list: (year?: number) =>
      request<AssetsResponse>(`/assets${year ? `?year=${year}` : ""}`),
    /** Standalone register entry (opening balance / pre-app purchase). */
    create: (data: CreateAssetData) =>
      request<Asset>("/assets", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: Partial<CreateAssetData> & DisposalData) =>
      request<Asset>(`/assets/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    delete: (id: string) => request<void>(`/assets/${id}`, { method: "DELETE" }),
  },
  reports: {
    /** The caller org's full tax picture for a year (Form 11, capital allowances, VAT). */
    taxSummary: (year?: number) =>
      request<TaxSummary>(`/reports/tax-summary${year ? `?year=${year}` : ""}`),
  },
  // Phase 6 billing. `status` drives the trial banner and the Settings card;
  // when the backend reports enforced:false both render nothing.
  billing: {
    /** The caller org's entitlement + whether billing is enforced platform-wide. */
    status: () => request<BillingStatus>("/billing/status"),
    /** Owner-only: Stripe Checkout URL (solo price, or per-seat for practices). */
    checkout: () =>
      request<{ url: string }>("/billing/checkout-session", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    /** Owner-only: Stripe customer-portal URL (cards, invoices, cancellation). */
    portal: () =>
      request<{ url: string }>("/billing/portal-session", {
        method: "POST",
        body: JSON.stringify({}),
      }),
  },
  // Sage Business Cloud export (feature-flagged; the backend 404s everything
  // under /sage unless SAGE_ENABLED=true). Connection is per practice org.
  sage: {
    /** Connection + config state driving the Settings card. */
    status: () => request<SageStatus>("/sage/status"),
    /** Owner-only: Sage consent URL - leave via window.location.href. */
    connect: () =>
      request<{ url: string }>("/sage/connect", { method: "POST", body: JSON.stringify({}) }),
    /** Owner-only: forget the stored connection (local delete). */
    disconnect: () => request<void>("/sage/connection", { method: "DELETE" }),
    /** Live lookups for the export dialog (any accountant in the practice). */
    businesses: () => request<SageOption[]>("/sage/businesses"),
    bankAccounts: (businessId: string) =>
      request<SageOption[]>(`/sage/businesses/${businessId}/bank-accounts`),
    ledgerAccounts: (businessId: string) =>
      request<SageOption[]>(`/sage/businesses/${businessId}/ledger-accounts`),
    taxRates: (businessId: string) =>
      request<SageOption[]>(`/sage/businesses/${businessId}/tax-rates`),
  },
  organisations: {
    get: (id: string) => request<Organisation>(`/organisations/${id}`),
    /** Effective category tree for the org plus the pristine type `defaults`. */
    getCategories: (id: string) =>
      request<OrgCategoriesResponse>(`/organisations/${id}/categories`),
    /** Owner-only partial update of org profile and/or the category tree. */
    update: (id: string, data: Partial<OrganisationInput> & { categories?: CategoryTree }) =>
      request<Organisation>(`/organisations/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    /** Owner-only: everyone in the org (owner + members). */
    members: (id: string) => request<OrgMember[]>(`/organisations/${id}/members`),
    /** Owner-only: invite someone to JOIN this org as a member. */
    inviteMember: (id: string, email: string) =>
      request<void>(`/organisations/${id}/invite-member`, {
        method: "POST",
        body: JSON.stringify({ email }),
      }),
  },
  // Accountant practice → client workspace. Every read verifies an active link
  // server-side; an unlinked/revoked client returns 403.
  accountant: {
    /** Linked client orgs with this-tax-year summary stats. */
    listClients: () => request<ClientSummary[]>("/accountant/clients"),
    /** A client org's transactions (optionally narrowed to a tax year). */
    getClientTransactions: (clientOrgId: string, year?: string | number) =>
      request<Expense[]>(
        `/accountant/clients/${clientOrgId}/transactions${year ? `?year=${year}` : ""}`,
      ),
    /** A client org's tax summary (same link gate as every client read). */
    getClientTaxSummary: (clientOrgId: string, year?: number) =>
      request<TaxSummary>(
        `/accountant/clients/${clientOrgId}/tax-summary${year ? `?year=${year}` : ""}`,
      ),
    /** Authenticated export of a client org (zip = Excel + images, or csv). */
    exportClient: (clientOrgId: string, year: string | number, format: "zip" | "csv" = "zip") =>
      requestBlob(`/accountant/clients/${clientOrgId}/export?format=${format}&year=${year}`),
    /** Revoke the practice's access to a client org. */
    revokeClient: (clientOrgId: string) =>
      request<void>(`/accountant/clients/${clientOrgId}/link`, { method: "DELETE" }),
    /** Firm admin: reassign a client to another accountant in the firm. */
    assignClient: (clientOrgId: string, accountantUserId: string) =>
      request<void>(`/accountant/clients/${clientOrgId}/assign`, {
        method: "PATCH",
        body: JSON.stringify({ accountantUserId }),
      }),
    /** Practice-only: invite someone who will create their OWN org, linked back. */
    inviteClient: (orgId: string, email: string) =>
      request<void>(`/organisations/${orgId}/invite-client`, {
        method: "POST",
        body: JSON.stringify({ email }),
      }),
    /** Remembered Sage mapping for a client (+ whether the practice is connected). */
    getSageExportSettings: (clientOrgId: string) =>
      request<SageClientSettings>(`/accountant/clients/${clientOrgId}/sage-settings`),
    /** Push a client's tax year into Sage; returns a created/skipped/failed summary. */
    exportClientToSage: (clientOrgId: string, data: SageExportRequest) =>
      request<SageExportResult>(`/accountant/clients/${clientOrgId}/sage-export`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
  },
  // Platform super-admin surface. Every route is super_admin-gated server-side.
  admin: {
    overview: () => request<PlatformStats>("/admin/overview"),
    orgs: () => request<AdminOrg[]>("/admin/orgs"),
    users: () => request<AdminUser[]>("/admin/users"),
    /** Invite a new account; kind 'accountant' provisions a firm on signup. */
    invite: (email: string, kind: "user" | "accountant") =>
      request<void>("/admin/invite", { method: "POST", body: JSON.stringify({ email, kind }) }),
    setUserPlatformRole: (id: string, platformRole: "user" | "super_admin") =>
      request<void>(`/admin/users/${id}/platform-role`, {
        method: "PATCH",
        body: JSON.stringify({ platformRole }),
      }),
    setUserStatus: (id: string, status: "active" | "suspended") =>
      request<void>(`/admin/users/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    /** GDPR hard-delete of a user (cascades their org if they solely own it). */
    deleteUser: (id: string) => request<void>(`/admin/users/${id}`, { method: "DELETE" }),
    setOrgStatus: (id: string, status: "active" | "suspended") =>
      request<void>(`/admin/orgs/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    /** GDPR hard-delete of an entire org and all its data. */
    deleteOrg: (id: string) => request<void>(`/admin/orgs/${id}`, { method: "DELETE" }),
  },
};

// ---------------------------------------------------------------------------
// Types - these mirror the *actual* backend shapes (verified against the
// Express controllers/models), not the earlier placeholder definitions.
// ---------------------------------------------------------------------------

/** Decoded JWT claims, returned by /api/auth/session. */
export interface Session {
  userId: string;
  role: "user" | "admin" | "accountant";
  orgId: string;
  orgRole: "owner" | "member";
  platformRole: "user" | "super_admin";
}

/** Flat user object returned by login/register (no nested `user`). */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: "user" | "admin" | "accountant";
}

/** A transaction row. Income is `category === 'income'` - there is no boolean. */
export interface Expense {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  category: string;
  amount: string | number; // Postgres NUMERIC arrives as a string
  currency: string;
  receipt_image_url: string | null;
  /** Set when this line item was captured from a shared receipt (Phase 2). */
  receipt_id: string | null;
  merchant_name: string | null;
  tax_amount: string | number | null;
  /** True when an asset-register row is linked (capital item, Phase 5). */
  is_capital?: boolean;
  created_at: string;
  updated_at: string;
}

// --- Billing (Phase 6) ------------------------------------------------------

/** The caller org's entitlement, returned by GET /billing/status. */
export interface BillingStatus {
  /** False until the platform flips BILLING_ENFORCED at GA. */
  enforced: boolean;
  /** Whether Stripe keys exist server-side (checkout/portal will work). */
  configured: boolean;
  active: boolean;
  tier: "trial" | "standard";
  status: "none" | "trialing" | "active" | "past_due" | "canceled" | "trial_expired";
  reason: "practice" | "subscribed" | "covered_seat" | "trial" | "expired";
  trialEndsAt: string | null;
  /** Set when a paying practice covers this org as a seat. */
  coveredByPracticeOrgId: string | null;
  /** Raw organisations.billing_status (a practice is always active yet may have no billing set up). */
  billingStatus: "none" | "trialing" | "active" | "past_due" | "canceled";
  isPractice: boolean;
  orgId: string;
  trialDays: number;
  tierInfo: { key: string; label: string; blurb: string };
  /** Practices only: active client seats being paid for. */
  seatCount?: number;
}

// --- Sage export ------------------------------------------------------------

/** GET /sage/status - drives the Settings Sage card. */
export interface SageStatus {
  enabled: boolean;
  /** Whether Sage credentials + token key exist server-side. */
  configured: boolean;
  connected: boolean;
  connectionStatus: "active" | "expired" | null;
  connectedAt: string | null;
  isPractice: boolean;
}

/** A Sage dropdown option (business, bank account, ledger account, tax rate). */
export interface SageOption {
  id: string;
  displayed_as: string;
}

/** Body of POST /accountant/clients/:id/sage-export. Names ride along for prefill display. */
export interface SageExportRequest {
  year: number;
  businessId: string;
  businessName?: string;
  bankAccountId: string;
  bankAccountName?: string;
  expenseLedgerAccountId: string;
  expenseLedgerAccountName?: string;
  incomeLedgerAccountId: string;
  incomeLedgerAccountName?: string;
  taxRateId?: string;
}

/** Per-run outcome summary returned by the Sage export. */
export interface SageExportResult {
  total: number;
  created: number;
  skipped: number;
  failed: number;
  failures: { expenseId: string; title: string; error: string }[];
}

/** GET /accountant/clients/:id/sage-settings - remembered mapping for prefill. */
export interface SageClientSettings {
  connected: boolean;
  settings: {
    sage_business_id: string;
    sage_business_name: string | null;
    bank_account_id: string;
    bank_account_name: string | null;
    expense_ledger_account_id: string;
    expense_ledger_account_name: string | null;
    income_ledger_account_id: string;
    income_ledger_account_name: string | null;
    tax_rate_id: string | null;
  } | null;
}

// --- Capital assets & tax summary (Phase 5) --------------------------------

export type AssetType = "plant_machinery" | "motor_vehicle";
export type VatStatus = "not_registered" | "registered" | "flat_rate_farmer";

/** A capital-asset register row. */
export interface Asset {
  id: string;
  user_id: string;
  /** Set when the asset was captured from an expense; null for opening balances. */
  expense_id: string | null;
  description: string;
  category: string | null;
  asset_type: AssetType;
  cost: string | number;
  currency: string;
  acquired_date: string;
  disposal_date: string | null;
  disposal_proceeds: string | number | null;
  created_at: string;
  updated_at: string;
}

export interface CreateAssetData {
  description: string;
  asset_type?: AssetType;
  cost: number;
  currency?: string;
  acquired_date?: string;
  category?: string;
}

export interface DisposalData {
  disposal_date?: string | null;
  disposal_proceeds?: number | null;
}

/** One line of the wear & tear schedule for a year. */
export interface AllowanceRow {
  id: string;
  expenseId: string | null;
  description: string;
  assetType: AssetType;
  category: string | null;
  cost: number;
  allowableCost: number;
  /** True when the €24k passenger-car cap reduced the allowable cost. */
  capped: boolean;
  acquiredDate: string;
  disposalDate: string | null;
  disposalProceeds: number | null;
  /** 1..8 - which year of the write-off this is. */
  yearIndex: number;
  allowance: number;
  openingWdv: number;
  closingWdv: number;
  disposed: boolean;
}

export interface CapitalAllowances {
  rows: AllowanceRow[];
  totals: { cost: number; allowance: number; closingWdv: number };
}

export interface AssetsResponse {
  year: number;
  assets: Asset[];
  schedule: CapitalAllowances;
}

export interface Form11Bucket {
  key: string;
  label: string;
  total: number;
  categories: { slug: string; label: string; total: number; count: number }[];
}

export interface VatPosition {
  vatStatus: VatStatus;
  inputVatReclaimable: boolean;
  vatOnPurchases: number;
  vatOnIncome: number;
  /** The flat-rate addition for the year (flat-rate farmers only). */
  flatRateAddition: number | null;
  /** Spend in VAT 58-eligible categories (buildings/fencing/drainage). */
  vat58EligibleSpend: number;
}

/** The full year picture returned by /reports/tax-summary and the accountant twin. */
export interface TaxSummary {
  year: number;
  orgId: string;
  orgName: string;
  orgCategory: string;
  vatStatus: VatStatus;
  totals: {
    income: number;
    revenueExpenses: number;
    capitalExpenditure: number;
    wearAndTear: number;
    netBeforeAdjustments: number;
  };
  counts: {
    transactions: number;
    income: number;
    revenue: number;
    capital: number;
    assets: number;
  };
  byCategory: { slug: string; label: string; total: number; count: number }[];
  form11: Form11Bucket[];
  capitalAllowances: CapitalAllowances;
  vat: VatPosition;
  capitalExpenseIds: string[];
}

// --- Receipts (Phase 2 camera-first capture) -------------------------------

/** Per-field OCR confidence (0..1). Drives the dormant auto-fill UI. */
export interface ReceiptFieldConfidence {
  merchant?: number;
  date?: number;
  total?: number;
  tax?: number;
  currency?: number;
}

/** Parsed receipt data. Null on the live flow today (OCR is disabled). */
export interface ReceiptParsed {
  merchant: string | null;
  date: string | null;
  total: number | null;
  tax: number | null;
  currency: string | null;
  lineItems?: { description: string; amount: number; category?: string }[];
  fieldConfidence?: ReceiptFieldConfidence;
}

/** A stored receipt row (returned by GET /receipts/:id). */
export interface Receipt {
  id: string;
  user_id: string;
  image_object_path: string | null;
  parsed_data: ReceiptParsed | null;
  ocr_confidence: string | number | null;
  receipt_status: "pending" | "reviewed" | "none";
  merchant_name: string | null;
  receipt_date: string | null;
  total_amount: string | number | null;
  tax_amount: string | number | null;
  currency: string | null;
  created_at: string;
  updated_at: string;
}

/** Response of POST /receipts/process. `parsedData` is null while OCR is off. */
export interface ReceiptProcessResult {
  receiptId: string;
  signedUrl: string;
  parsedData: ReceiptParsed | null;
  ocrConfidence: number | null;
  receiptStatus: string;
}

/** One expense line item posted to POST /receipts/:id/expenses. */
export interface ReceiptLineItemInput {
  title?: string;
  description?: string;
  category: string;
  amount: number;
  currency?: string;
  merchant_name?: string;
  tax_amount?: number;
  /** Capital item: also writes an asset-register row (wear & tear over 8 yrs). */
  is_capital?: boolean;
  asset_type?: AssetType;
  asset_description?: string;
}

export interface CreateExpenseData {
  title: string;
  description?: string;
  category: string;
  amount: number;
  currency: string;
  image?: string; // base64 data URL; backend uploads it and stores the object path
  /** Transaction date as YYYY-MM-DD; maps to created_at on the backend. */
  date?: string;
  /**
   * Capital item marker. Create: true also writes an asset-register row.
   * Update (PATCH): tri-state - true upserts the linked asset, false removes
   * it, omitted leaves the register alone.
   */
  is_capital?: boolean;
  asset_type?: AssetType;
  asset_description?: string;
}

export type UpdateExpenseData = Partial<CreateExpenseData>;

/** Self-serve and invite-based signup share this payload (token optional). */
export interface RegisterData {
  fname: string;
  mname?: string;
  sname: string;
  email: string;
  password: string;
  phone_number?: string;
  date_of_birth?: string;
  ppsno?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  county?: string;
  country?: string;
  tax_status?: string;
  marital_status?: string;
  postal_code?: string;
  occupation?: string;
  currency: string;
  /** Invite token from the email link; omit for self-serve signup. */
  token?: string;
  /** Optional org-creation step (self-serve only). Omit to get an auto-named personal org. */
  organisation?: OrganisationInput;
}

/** Fields a user may set when creating or editing their organisation. */
export interface OrganisationInput {
  name: string;
  description?: string;
  country?: string;
  vat_number?: string;
  /** Derived from org_category on the backend when omitted. */
  type?: "personal" | "business";
  org_category?: string;
  vat_status?: VatStatus;
}

/** Organisation row returned by the backend. */
export interface Organisation {
  id: string;
  name: string;
  type: "personal" | "business";
  description?: string | null;
  country?: string;
  vat_number?: string | null;
  org_category: string;
  categories?: CategoryTree | null;
  owner_account_id?: string | null;
  subscription_level?: string | null;
  /** True for accountancy practice orgs (unlocks the Clients workspace). */
  is_accountant_practice?: boolean;
  /** Lifecycle status; a suspended org's users cannot log in. */
  status?: "active" | "suspended";
  /** VAT treatment - drives the VAT section of the tax summary. */
  vat_status?: VatStatus;
  created_at?: string;
  updated_at?: string;
}

/** Platform-wide counts + this-tax-year totals (GET /admin/overview). */
export interface PlatformStats {
  orgs: string | number;
  users: string | number;
  firms: string | number;
  clients: string | number;
  txns: string | number;
  expense_total: string | number;
  income_total: string | number;
}

/** An organisation row in the super-admin overview. */
export interface AdminOrg {
  id: string;
  name: string;
  type: "personal" | "business";
  org_category: string;
  is_accountant_practice: boolean;
  status: "active" | "suspended";
  member_count: string | number;
  txn_count: string | number;
  expense_total: string | number;
  income_total: string | number;
  last_activity: string | null;
  created_at: string;
}

/** A user row in the super-admin overview. */
export interface AdminUser {
  id: string;
  fname: string;
  sname: string;
  email: string;
  role: "user" | "admin" | "accountant";
  org_role: "owner" | "member";
  platform_role: "user" | "super_admin";
  account_status: string;
  org_id: string | null;
  org_name: string | null;
  is_accountant_practice: boolean | null;
  created_at: string;
  last_login: string | null;
}

/** A member of an org, as listed in the Team view. */
export interface OrgMember {
  id: string;
  fname: string;
  sname: string;
  email: string;
  org_role: "owner" | "member";
  role: "user" | "admin" | "accountant";
  account_status?: string;
  created_at?: string;
  last_login?: string;
}

/** A linked client org with this-tax-year rollups (GET /accountant/clients). */
export interface ClientSummary {
  id: string;
  name: string;
  type: "personal" | "business";
  org_category: string;
  /** Postgres count/NUMERIC arrive as strings. */
  txn_count: string | number;
  expense_total: string | number;
  income_total: string | number;
  last_activity: string | null;
  /** Owning accountant (created_by) - shown to the firm admin. */
  created_by: string | null;
  owner_name: string | null;
}

/** A node in the org category tree. A leaf (no children) is what gets stored on a transaction. */
export interface CategoryNode {
  slug: string;
  label: string;
  children?: CategoryNode[];
  /** Suggests "capital item" in the transaction form (never enforced). */
  capital?: boolean;
  /** Spend here counts toward the VAT 58 farmer-reclaim prompt. */
  vat58?: boolean;
}

export interface CategoryTree {
  expense: CategoryNode[];
  income: CategoryNode[];
}

/** Response of GET /organisations/:id/categories. */
export interface OrgCategoriesResponse {
  orgCategory: string;
  /** Effective tree: the org's stored custom tree, or the type template. */
  categories: CategoryTree;
  /** True when the org has a stored (edited) tree. */
  isCustom: boolean;
  /** Pristine template for the org's type, for "Reset to defaults". */
  defaults: CategoryTree;
}

export interface UserProfile {
  id: string;
  fname: string;
  mname?: string;
  sname: string;
  email: string;
  phone_number?: string;
  date_of_birth?: string;
  ppsno?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  county?: string;
  country?: string;
  tax_status?: string;
  marital_status?: string;
  postal_code?: string;
  occupation?: string;
  currency: string;
  role: "user" | "admin" | "accountant";
  subscription_level?: string;
  account_status?: string;
  renewal_date?: string;
  /** Null = verification pending (Phase 6); undefined on pre-migration backends. */
  email_verified_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface SupportData {
  userEmail: string;
  issueType: string;
  issueDescription: string;
}

// --- helpers ---------------------------------------------------------------

export const isIncome = (e: Pick<Expense, "category">) => e.category === "income";

export const amountOf = (e: Pick<Expense, "amount">) => Number(e.amount) || 0;

/** Format a number in the given ISO currency, falling back gracefully. */
export function formatCurrency(value: number, currency = "EUR"): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}
