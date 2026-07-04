"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, type Organisation, type UserProfile } from "@/lib/api";
import { CURRENCIES } from "@/lib/categories";
import { COUNTRIES, ORG_CATEGORIES, VAT_STATUS_OPTIONS } from "@/lib/org";
import { useSession } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { OrgCategoriesEditor } from "@/components/org-categories-editor";
import { BillingCard } from "@/components/billing-card";
import { SageCard } from "@/components/sage-card";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

const PERSONAL_FIELDS = [
  { key: "fname", label: "First name" },
  { key: "sname", label: "Surname" },
  { key: "occupation", label: "Occupation" },
  { key: "phone_number", label: "Phone number" },
] as const;

const ADDRESS_FIELDS = [
  { key: "address_line1", label: "Address line 1" },
  { key: "city", label: "City" },
  { key: "postal_code", label: "Postal code" },
  { key: "country", label: "Country" },
] as const;

const EDITABLE_KEYS = [...PERSONAL_FIELDS, ...ADDRESS_FIELDS].map((f) => f.key);

export default function SettingsPage() {
  const router = useRouter();
  const { session, loading: sessionLoading } = useSession();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [form, setForm] = useState<Partial<UserProfile>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [org, setOrg] = useState<Organisation | null>(null);
  const [orgForm, setOrgForm] = useState<Partial<Organisation>>({});
  const [orgSaving, setOrgSaving] = useState(false);
  const isOwner = session?.orgRole === "owner";

  useEffect(() => {
    if (sessionLoading) return;
    if (!session) {
      setLoading(false);
      return;
    }
    let active = true;
    api.users
      .getById(session.userId)
      .then((p) => {
        if (!active) return;
        setProfile(p);
        setForm(p);
      })
      .catch((err) => active && toast.error(err instanceof Error ? err.message : "Failed to load profile"))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [session, sessionLoading]);

  useEffect(() => {
    if (sessionLoading || !session) return;
    let active = true;
    api.organisations
      .get(session.orgId)
      .then((o) => {
        if (!active) return;
        setOrg(o);
        setOrgForm(o);
      })
      .catch((err) => active && toast.error(err instanceof Error ? err.message : "Failed to load organisation"));
    return () => {
      active = false;
    };
  }, [session, sessionLoading]);

  function update(key: keyof UserProfile, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function updateOrg(key: keyof Organisation, value: string) {
    setOrgForm((f) => ({ ...f, [key]: value }));
  }

  async function handleOrgSave() {
    if (!session || !org) return;
    setOrgSaving(true);
    try {
      // Keep the coarse `type` consistent with the chosen business type.
      const org_category = orgForm.org_category ?? org.org_category;
      const type = org_category !== "personal" ? "business" : "personal";
      const updated = await api.organisations.update(session.orgId, {
        name: orgForm.name ?? org.name,
        description: orgForm.description ?? "",
        country: orgForm.country ?? org.country,
        vat_number: orgForm.vat_number ?? "",
        org_category,
        type,
        vat_status: orgForm.vat_status ?? org.vat_status ?? "not_registered",
      });
      setOrg(updated);
      setOrgForm(updated);
      toast.success("Organisation saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save organisation");
    } finally {
      setOrgSaving(false);
    }
  }

  async function handleSave() {
    if (!session) return;
    setSaving(true);
    try {
      const payload: Partial<UserProfile> = { currency: form.currency };
      for (const key of EDITABLE_KEYS) payload[key] = form[key] as never;
      const updated = await api.users.update(session.userId, payload);
      setProfile(updated);
      setForm(updated);
      toast.success("Settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleLogout() {
    await api.auth.logout().catch(() => {});
    router.push("/login");
  }

  if (loading || sessionLoading) {
    return (
      <div className="space-y-8">
        <PageHeader title="Settings" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader title="Settings" description="Manage your profile and preferences." />

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Used on your exports and tax records.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            {PERSONAL_FIELDS.map(({ key, label }) => (
              <Field key={key} label={label} htmlFor={`profile-${key}`}>
                <Input
                  id={`profile-${key}`}
                  value={(form[key] as string) ?? ""}
                  onChange={(e) => update(key, e.target.value)}
                />
              </Field>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {ADDRESS_FIELDS.map(({ key, label }) => (
              <Field key={key} label={label} htmlFor={`profile-${key}`}>
                <Input
                  id={`profile-${key}`}
                  value={(form[key] as string) ?? ""}
                  onChange={(e) => update(key, e.target.value)}
                />
              </Field>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email" htmlFor="profile-email" hint="Contact support to change your email.">
              <Input id="profile-email" value={profile?.email ?? ""} readOnly className="bg-muted/50" />
            </Field>
            <Field label="Currency" htmlFor="profile-currency">
              <Select value={form.currency ?? "EUR"} onValueChange={(v) => update("currency", v)}>
                <SelectTrigger id="profile-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Spinner />}
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {session && (
        <Card>
          <CardHeader>
            <CardTitle>Organisation</CardTitle>
            <CardDescription>
              {isOwner
                ? "Your business details and the type that tailors your categories."
                : "Your organisation details. Only the owner can edit these."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Organisation name" htmlFor="org-name">
                <Input
                  id="org-name"
                  value={orgForm.name ?? ""}
                  disabled={!isOwner}
                  onChange={(e) => updateOrg("name", e.target.value)}
                />
              </Field>
              <Field label="Business type" htmlFor="org-category">
                <Select
                  value={orgForm.org_category ?? "personal"}
                  disabled={!isOwner}
                  onValueChange={(v) => updateOrg("org_category", v)}
                >
                  <SelectTrigger id="org-category">
                    <SelectValue />
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
            </div>
            <Field label="Description" htmlFor="org-description">
              <Textarea
                id="org-description"
                rows={2}
                value={orgForm.description ?? ""}
                disabled={!isOwner}
                onChange={(e) => updateOrg("description", e.target.value)}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Country" htmlFor="org-country">
                <Select
                  value={orgForm.country ?? "IE"}
                  disabled={!isOwner}
                  onValueChange={(v) => updateOrg("country", v)}
                >
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
              {(orgForm.country ?? "IE") === "IE" && (
                <Field label="VAT number" htmlFor="org-vat" hint="Optional">
                  <Input
                    id="org-vat"
                    value={orgForm.vat_number ?? ""}
                    disabled={!isOwner}
                    onChange={(e) => updateOrg("vat_number", e.target.value)}
                    placeholder="IE1234567T"
                  />
                </Field>
              )}
            </div>
            <Field
              label="VAT status"
              htmlFor="org-vat-status"
              hint={
                VAT_STATUS_OPTIONS.find(
                  (o) => o.value === (orgForm.vat_status ?? "not_registered"),
                )?.hint
              }
            >
              <Select
                value={orgForm.vat_status ?? "not_registered"}
                disabled={!isOwner}
                onValueChange={(v) => updateOrg("vat_status", v)}
              >
                <SelectTrigger id="org-vat-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VAT_STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {isOwner && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Changing your business type won&apos;t rewrite past transactions. Use “Reset to
                  defaults” under Categories to load this type&apos;s category list.
                </p>
                <Button onClick={handleOrgSave} disabled={orgSaving}>
                  {orgSaving && <Spinner />}
                  {orgSaving ? "Saving…" : "Save organisation"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {session && (
        <Card>
          <CardHeader>
            <CardTitle>Categories</CardTitle>
            <CardDescription>
              The expense and income categories shown when you add a transaction. Add your own and
              group them with subcategories.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OrgCategoriesEditor orgId={session.orgId} canEdit={!!isOwner} />
          </CardContent>
        </Card>
      )}

      <BillingCard isOwner={!!isOwner} />

      <SageCard isOwner={!!isOwner} org={org} />

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Records are kept while your account is active - Irish Revenue requires keeping tax
            records for 6 years. Export before deleting anything you still need. See the{" "}
            <a
              href="/privacy"
              target="_blank"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Privacy Policy
            </a>
            .
          </p>
          <Button
            variant="outline"
            onClick={handleLogout}
            className="text-destructive hover:bg-destructive/10"
          >
            Log out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
