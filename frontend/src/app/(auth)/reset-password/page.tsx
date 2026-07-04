"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { PasswordFields, passwordMeetsRules } from "@/components/password-fields";
import { Spinner } from "@/components/ui/spinner";

// The page behind the emailed reset link (/reset-password?token=…). The token
// is only valid for 1 hour; a failed submit points back to /forgot-password
// for a fresh one.
function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!passwordMeetsRules(password)) {
      setError("Your password does not meet all the requirements listed below it.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      await api.users.resetPassword(token as string, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Reset link missing</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          This page only works from the link in a password-reset email. Request a new one below.
        </p>
        <Button asChild className="mt-8 w-full">
          <Link href="/forgot-password">Request a reset link</Link>
        </Button>
      </div>
    );
  }

  if (done) {
    return (
      <div className="text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-success/10">
          <KeyRound className="size-6 text-success" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Password updated</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          You can now sign in with your new password.
        </p>
        <Button asChild className="mt-8 w-full">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Set a new password for your account to finish the reset.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
            {error}
          </p>
        )}
        <PasswordFields
          password={password}
          confirmPassword={confirmPassword}
          onPasswordChange={setPassword}
          onConfirmPasswordChange={setConfirmPassword}
        />
        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <Spinner />}
          {loading ? "Updating…" : "Update password"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Link expired?{" "}
        <Link href="/forgot-password" className="font-medium text-primary hover:underline">
          Request a new one
        </Link>
      </p>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
