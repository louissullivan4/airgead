"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { BRAND } from "@/lib/brand";
import { COUNTRIES, DEFAULT_COUNTRY, ORG_CATEGORIES } from "@/lib/org";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("token") ?? undefined;

  const [fname, setFname] = useState("");
  const [sname, setSname] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Optional org-creation step (self-serve only). Invitees join the inviter's
  // org, so the section is hidden for them.
  const [showOrg, setShowOrg] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [orgDescription, setOrgDescription] = useState("");
  const [orgCountry, setOrgCountry] = useState(DEFAULT_COUNTRY);
  const [orgVat, setOrgVat] = useState("");
  const [orgCategory, setOrgCategory] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // Currency defaults to EUR; address/occupation/tax details are collected
      // later in Settings to keep signup short. The organisation is sent only
      // when the user opened the section and named it — otherwise the backend
      // auto-creates a personal org.
      const organisation =
        !inviteToken && showOrg && orgName.trim()
          ? {
              name: orgName.trim(),
              description: orgDescription.trim() || undefined,
              country: orgCountry,
              vat_number:
                orgCountry === "IE" && orgVat.trim() ? orgVat.trim() : undefined,
              org_category: orgCategory || undefined,
            }
          : undefined;
      await api.auth.register({
        fname,
        sname,
        email,
        password,
        currency: "EUR",
        token: inviteToken,
        organisation,
      });
      router.push("/home");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {inviteToken
          ? "You've been invited — finish setting up your account."
          : `Start tracking expenses with ${BRAND}. It's free.`}
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
        <Field label="Password" htmlFor="password" hint="At least 8 characters.">
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>

        {!inviteToken && (
          <div className="rounded-lg border border-border p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Set up your organisation</p>
                <p className="text-xs text-muted-foreground">
                  Optional — tailors your expense categories to your trade. You can do this later in Settings.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowOrg((v) => !v)}
              >
                {showOrg ? "Skip" : "Add details"}
              </Button>
            </div>

            {showOrg && (
              <div className="mt-4 space-y-4">
                <Field label="Organisation name" htmlFor="org-name">
                  <Input
                    id="org-name"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    placeholder="e.g. Galway Equine"
                  />
                </Field>
                <Field label="Description" htmlFor="org-description" hint="Optional">
                  <Textarea
                    id="org-description"
                    rows={2}
                    value={orgDescription}
                    onChange={(e) => setOrgDescription(e.target.value)}
                    placeholder="What does your business do?"
                  />
                </Field>
                <Field label="Business type" htmlFor="org-category">
                  <Select value={orgCategory} onValueChange={setOrgCategory}>
                    <SelectTrigger id="org-category">
                      <SelectValue placeholder="Select a type" />
                    </SelectTrigger>
                    <SelectContent>
                      {ORG_CATEGORIES.map((c) => (
                        <SelectItem key={c.slug} value={c.slug}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Country" htmlFor="org-country">
                    <Select value={orgCountry} onValueChange={setOrgCountry}>
                      <SelectTrigger id="org-country">
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
                  {orgCountry === "IE" && (
                    <Field label="VAT number" htmlFor="org-vat" hint="Optional">
                      <Input
                        id="org-vat"
                        value={orgVat}
                        onChange={(e) => setOrgVat(e.target.value)}
                        placeholder="IE1234567T"
                      />
                    </Field>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <Spinner />}
          {loading ? "Creating account…" : "Create account"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
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
