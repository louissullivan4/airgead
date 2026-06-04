"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  TextInput,
  PasswordInput,
  Select,
  SelectItem,
  Button,
  InlineNotification,
  Tile,
} from "@carbon/react";
import { api, type RegisterData } from "@/lib/api";
import { BRAND } from "@/lib/brand";

const CURRENCIES = ["EUR", "GBP", "USD"];

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("token") ?? undefined;

  const [form, setForm] = useState<RegisterData>({
    fname: "",
    sname: "",
    email: "",
    password: "",
    currency: "EUR",
    phone_number: "",
    occupation: "",
    address_line1: "",
    city: "",
    postal_code: "",
    country: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function set<K extends keyof RegisterData>(key: K, value: RegisterData[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.auth.register({ ...form, token: inviteToken });
      router.push("/home");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <Tile className="auth-card" style={{ maxWidth: "40rem" }}>
        <h1 style={{ marginBottom: "0.5rem" }}>Create your {BRAND} account</h1>
        <p style={{ color: "var(--cds-text-secondary)", marginBottom: "1.5rem" }}>
          {inviteToken
            ? "You've been invited — complete your details to join."
            : "Set up a personal account to start tracking expenses."}
        </p>
        <form onSubmit={handleSubmit}>
          {error && (
            <InlineNotification kind="error" title="Could not sign up" subtitle={error} lowContrast />
          )}
          <div className="form-grid" style={{ marginBottom: "1rem" }}>
            <TextInput id="fname" labelText="First name" value={form.fname} onChange={(e) => set("fname", e.target.value)} required />
            <TextInput id="sname" labelText="Surname" value={form.sname} onChange={(e) => set("sname", e.target.value)} required />
            <TextInput id="email" labelText="Email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required autoComplete="email" />
            <TextInput id="phone" labelText="Phone number" value={form.phone_number} onChange={(e) => set("phone_number", e.target.value)} />
            <TextInput id="occupation" labelText="Occupation" value={form.occupation} onChange={(e) => set("occupation", e.target.value)} />
            <TextInput id="address" labelText="Address line 1" value={form.address_line1} onChange={(e) => set("address_line1", e.target.value)} />
            <TextInput id="city" labelText="City" value={form.city} onChange={(e) => set("city", e.target.value)} />
            <TextInput id="postal" labelText="Postal code" value={form.postal_code} onChange={(e) => set("postal_code", e.target.value)} />
            <TextInput id="country" labelText="Country" value={form.country} onChange={(e) => set("country", e.target.value)} />
            <Select id="currency" labelText="Currency" value={form.currency} onChange={(e) => set("currency", e.target.value)}>
              {CURRENCIES.map((c) => (
                <SelectItem key={c} value={c} text={c} />
              ))}
            </Select>
          </div>
          <PasswordInput
            id="password"
            labelText="Password"
            value={form.password}
            onChange={(e) => set("password", e.target.value)}
            required
            autoComplete="new-password"
          />
          <Button type="submit" disabled={loading} style={{ width: "100%", maxWidth: "100%", marginTop: "1rem" }}>
            {loading ? "Creating account…" : "Create account"}
          </Button>
        </form>
        <p style={{ marginTop: "1rem" }}>
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </Tile>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  );
}
