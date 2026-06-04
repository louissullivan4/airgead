"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { TextInput, PasswordInput, Button, InlineNotification, Tile } from "@carbon/react";
import { api } from "@/lib/api";
import { BRAND } from "@/lib/brand";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.auth.login(email, password);
      router.push("/home");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <Tile className="auth-card">
        <h1 style={{ marginBottom: "1.5rem" }}>Sign in to {BRAND}</h1>
        <form onSubmit={handleSubmit}>
          {error && (
            <InlineNotification kind="error" title="Sign in failed" subtitle={error} lowContrast />
          )}
          <TextInput
            id="email"
            labelText="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <PasswordInput
            id="password"
            labelText="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
          <Button type="submit" disabled={loading} style={{ width: "100%", maxWidth: "100%" }}>
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        <p style={{ marginTop: "1rem" }}>
          Don&apos;t have an account? <Link href="/signup">Sign up</Link>
        </p>
        <p>
          <Link href="/forgot-password">Forgot password?</Link>
        </p>
      </Tile>
    </div>
  );
}
