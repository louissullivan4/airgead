"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { TextInput, Button, InlineNotification, Tile } from "@carbon/react";
import { api } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.users.requestPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <Tile className="auth-card">
        <h1 style={{ marginBottom: "1.5rem" }}>Reset your password</h1>
        {sent ? (
          <InlineNotification
            kind="success"
            title="Check your email"
            subtitle="If an account exists for that address, a reset link is on its way."
            lowContrast
            hideCloseButton
          />
        ) : (
          <form onSubmit={handleSubmit}>
            {error && <InlineNotification kind="error" title="Error" subtitle={error} lowContrast />}
            <TextInput
              id="email"
              labelText="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
            <Button type="submit" disabled={loading} style={{ width: "100%", maxWidth: "100%" }}>
              {loading ? "Sending…" : "Send reset link"}
            </Button>
          </form>
        )}
        <p style={{ marginTop: "1rem" }}>
          <Link href="/login">Back to sign in</Link>
        </p>
      </Tile>
    </div>
  );
}
