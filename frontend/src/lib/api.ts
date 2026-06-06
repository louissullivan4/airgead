// API client for the rian web app.
//
// Auth is handled by a Next.js BFF: the JWT lives in an httpOnly cookie that the
// browser never reads. All backend calls go same-origin through `/api/proxy/*`
// (see src/app/api/proxy/[...path]/route.ts), which attaches the Bearer token
// server-side. Auth lifecycle (login/register/logout/session) uses the dedicated
// `/api/auth/*` route handlers.

const PROXY = "/api/proxy";

/** Thrown by the API client so callers can show `err.message`. */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function parseError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? res.statusText ?? "Request failed";
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
    throw new ApiError(await parseError(res), res.status);
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
    throw new ApiError(await parseError(res), res.status);
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
  if (!res.ok) throw new ApiError(await parseError(res), res.status);
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
// Types — these mirror the *actual* backend shapes (verified against the
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

/** A transaction row. Income is `category === 'income'` — there is no boolean. */
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
  created_at: string;
  updated_at: string;
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
  /** Owning accountant (created_by) — shown to the firm admin. */
  created_by: string | null;
  owner_name: string | null;
}

/** A node in the org category tree. A leaf (no children) is what gets stored on a transaction. */
export interface CategoryNode {
  slug: string;
  label: string;
  children?: CategoryNode[];
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
