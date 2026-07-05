"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { BRAND } from "@/lib/brand";
import { COUNTRIES, DEFAULT_COUNTRY } from "@/lib/org";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PasswordFields, passwordMeetsRules } from "@/components/password-fields";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

// Dedicated signup for accountancy practices (linked from the landing page's
// "For accountants" and from the main signup). Always creates a practice org
// (is_accountant_practice), so there is no business-type picker here and the
// practice name is mandatory - unlike the optional org section on /signup.
export default function AccountantSignupPage() {
  const [fname, setFname] = useState("");
  const [sname, setSname] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [practiceName, setPracticeName] = useState("");
  const [practiceNameError, setPracticeNameError] = useState<string | null>(null);
  const [practiceDescription, setPracticeDescription] = useState("");
  const [country, setCountry] = useState(DEFAULT_COUNTRY);
  const [vatNumber, setVatNumber] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPracticeNameError(null);
    if (!consent) {
      setError("Please agree to the Terms of Service and Privacy Policy to continue.");
      return;
    }
    if (!passwordMeetsRules(password)) {
      setError("Your password does not meet all the requirements listed below it.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (!practiceName.trim()) {
      setPracticeNameError("Practice name is required.");
      return;
    }
    setLoading(true);
    try {
      await api.auth.register({
        fname,
        sname,
        email,
        password,
        currency: "EUR",
        organisation: {
          name: practiceName.trim(),
          description: practiceDescription.trim() || undefined,
          country,
          vat_number: country === "IE" && vatNumber.trim() ? vatNumber.trim() : undefined,
          is_accountant_practice: true,
        },
      });
      // The practice account is created PENDING review - show the confirmation
      // rather than dropping them straight into the (still-locked) workspace.
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Application received</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Thanks for applying. We review every practice before activating it - we&apos;ll email{" "}
          <span className="font-medium text-foreground">{email}</span> as soon as{" "}
          {practiceName.trim() || "your practice"} is approved.
        </p>
        <div className="mt-6 rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          Once approved, your practice account is free and you can invite clients from the Clients
          workspace. Each client gets a 14-day free trial and then subscribes directly.
        </div>
        <Button asChild className="mt-8 w-full">
          <Link href="/home">Go to your dashboard</Link>
        </Button>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Create your practice</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {`For accountancy practices: manage your clients' books with ${BRAND} - invite clients, review their records, and export tax-ready packs.`}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        New practices are reviewed before activation. It&apos;s free for your practice - your clients
        subscribe directly.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
            {error}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" htmlFor="fname">
            <Input
              id="fname"
              autoComplete="given-name"
              value={fname}
              onChange={(e) => setFname(e.target.value)}
              required
            />
          </Field>
          <Field label="Surname" htmlFor="sname">
            <Input
              id="sname"
              autoComplete="family-name"
              value={sname}
              onChange={(e) => setSname(e.target.value)}
              required
            />
          </Field>
        </div>
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
        <PasswordFields
          password={password}
          confirmPassword={confirmPassword}
          onPasswordChange={setPassword}
          onConfirmPasswordChange={setConfirmPassword}
        />

        <div className="space-y-4 rounded-lg border border-border p-4">
          <div>
            <p className="text-sm font-medium">Your practice</p>
            <p className="text-xs text-muted-foreground">
              Unlocks the Clients workspace to invite and oversee client organisations.
            </p>
          </div>
          <Field
            label="Practice name"
            htmlFor="practice-name"
            required
            error={practiceNameError ?? undefined}
          >
            <Input
              id="practice-name"
              value={practiceName}
              onChange={(e) => {
                setPracticeName(e.target.value);
                setPracticeNameError(null);
              }}
              placeholder="e.g. Sullivan & Co. Accountants"
              aria-invalid={practiceNameError ? true : undefined}
              required
            />
          </Field>
          <Field label="Description" htmlFor="practice-description" hint="Optional">
            <Textarea
              id="practice-description"
              rows={2}
              value={practiceDescription}
              onChange={(e) => setPracticeDescription(e.target.value)}
              placeholder="What does your practice specialise in?"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Country" htmlFor="practice-country">
              <Select value={country} onValueChange={setCountry}>
                <SelectTrigger id="practice-country">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COUNTRIES.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {country === "IE" && (
              <Field label="VAT number" htmlFor="practice-vat" hint="Optional">
                <Input
                  id="practice-vat"
                  value={vatNumber}
                  onChange={(e) => setVatNumber(e.target.value)}
                  placeholder="IE1234567T"
                />
              </Field>
            )}
          </div>
        </div>

        <label htmlFor="consent" className="flex cursor-pointer items-start gap-3 text-sm">
          <input
            id="consent"
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 size-4 accent-primary"
            required
          />
          <span className="text-muted-foreground">
            I agree to the{" "}
            <Link
              href="/terms"
              target="_blank"
              className="font-medium text-foreground underline underline-offset-2 hover:no-underline"
            >
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link
              href="/privacy"
              target="_blank"
              className="font-medium text-foreground underline underline-offset-2 hover:no-underline"
            >
              Privacy Policy
            </Link>
            .
          </span>
        </label>

        <Button type="submit" className="w-full" disabled={loading || !consent}>
          {loading && <Spinner />}
          {loading ? "Creating practice…" : "Create practice"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Not an accountancy practice?{" "}
        <Link href="/signup" className="font-medium text-primary hover:underline">
          Sign up here
        </Link>
      </p>
      <p className="mt-2 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
