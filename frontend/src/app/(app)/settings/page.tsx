"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, type UserProfile } from "@/lib/api";
import { CURRENCIES } from "@/lib/categories";
import { useSession } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

  function update(key: keyof UserProfile, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
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

      <Card>
        <CardHeader>
          <CardTitle>Plan</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Badge>{profile?.subscription_level ?? "Free"}</Badge>
          <span className="text-sm text-muted-foreground">{"You're on the Free plan."}</span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent>
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
