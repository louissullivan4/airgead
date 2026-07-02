"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { BRAND } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [resending, setResending] = useState(false);

  // The email-verification link bounces here: ?verified=1 on success,
  // ?verified=expired when the token is stale (offer a resend below).
  useEffect(() => {
    const verified = new URLSearchParams(window.location.search).get("verified");
    if (!verified) return;
    if (verified === "1") toast.success("Email verified - you can sign in now.");
    if (verified === "expired") {
      setUnverified(true);
      setError("That verification link has expired. Enter your email and request a new one.");
    }
    router.replace("/login");
  }, [router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setUnverified(false);
    setLoading(true);
    try {
      await api.auth.login(email, password);
      router.push("/home");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === "email_unverified") {
        setUnverified(true);
      }
      setError(err instanceof Error ? err.message : "Sign in failed");
      setLoading(false);
    }
  }

  async function handleResend() {
    if (!email) {
      setError("Enter your email address first, then request a new link.");
      return;
    }
    setResending(true);
    try {
      await api.users.resendVerification(email);
      toast.success("If that address needs verification, a new link is on its way.");
    } catch {
      toast.error("Could not send the link - please try again shortly.");
    } finally {
      setResending(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">Sign in to your {BRAND} account.</p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        {error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
            {error}
            {unverified && (
              <button
                type="button"
                onClick={handleResend}
                disabled={resending}
                className="mt-1 block font-semibold underline underline-offset-2 hover:no-underline disabled:opacity-60"
              >
                {resending ? "Sending…" : "Send a new verification link"}
              </button>
            )}
          </div>
        )}
        <Field label="Email" htmlFor="email">
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <div className="flex justify-end">
          <Link
            href="/forgot-password"
            className="text-sm font-medium text-primary hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <Spinner />}
          {loading ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="font-medium text-primary hover:underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}
