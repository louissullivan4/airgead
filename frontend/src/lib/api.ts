const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((error as { error?: string }).error ?? "Request failed");
  }
  return res.json() as Promise<T>;
}

export const api = {
  auth: {
    login: (email: string, password: string) =>
      request<AuthResponse>("/users/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    signup: (data: SignupData) =>
      request<AuthResponse>("/users/signup", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    dashboardLogin: (email: string, password: string) =>
      request<AuthResponse>("/users/dashboard-login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    requestPasswordReset: (email: string) =>
      request<void>("/users/request-password-reset", {
        method: "POST",
        body: JSON.stringify({ email }),
      }),
    resetPassword: (token: string, password: string) =>
      request<void>("/users/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      }),
  },
  users: {
    getAll: () => request<User[]>("/users"),
    getById: (id: string) => request<User>(`/users/${id}`),
    getByEmail: (email: string) => request<User>(`/users/email/${email}`),
    update: (id: string, data: Partial<User>) =>
      request<User>(`/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    delete: (email: string) =>
      request<void>(`/users/email/${email}`, { method: "DELETE" }),
    invite: (data: InviteData) =>
      request<void>("/users/invite", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    support: (data: SupportData) =>
      request<void>("/users/support", {
        method: "POST",
        body: JSON.stringify(data),
      }),
  },
  expenses: {
    getAll: () => request<Expense[]>("/expenses"),
    getById: (id: string) => request<Expense>(`/expenses/${id}`),
    getByUserId: (id: string) => request<Expense[]>(`/expenses/users/${id}`),
    getByUserIdNoIncome: (id: string) =>
      request<Expense[]>(`/expenses/users/income/${id}`),
    getByUserIdAndYear: (id: string, year: string) =>
      request<Expense[]>(`/expenses/users/${id}/${year}`),
    create: (data: CreateExpenseData) =>
      request<Expense>("/expenses", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<Expense>) =>
      request<Expense>(`/expenses/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    patch: (id: string, data: Partial<Expense>) =>
      request<Expense>(`/expenses/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      request<void>(`/expenses/${id}`, { method: "DELETE" }),
    excelDownloadUrl: (id: string, year: string) =>
      `${BASE_URL}/expenses/downloads/${id}/${year}`,
  },
};

export interface AuthResponse {
  token: string;
  user: User;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: "admin" | "accountant" | "user";
  created_at: string;
}

export interface Expense {
  id: string;
  user_id: string;
  amount: number;
  category: string;
  description: string;
  date: string;
  is_income: boolean;
  receipt_url?: string;
  created_at: string;
}

export interface SignupData {
  email: string;
  password: string;
  name: string;
}

export interface InviteData {
  email: string;
  name: string;
  role: string;
}

export interface SupportData {
  email: string;
  subject: string;
  message: string;
}

export interface CreateExpenseData {
  user_id: string;
  amount: number;
  category: string;
  description: string;
  date: string;
  is_income?: boolean;
}
