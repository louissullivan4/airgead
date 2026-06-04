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
  created_at: string;
  updated_at: string;
}

export interface CreateExpenseData {
  title: string;
  description?: string;
  category: string;
  amount: number;
  currency: string;
  image?: string; // base64 data URL; backend uploads it and stores the object path
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
