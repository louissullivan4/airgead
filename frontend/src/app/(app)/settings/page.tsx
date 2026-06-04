"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  TextInput,
  Select,
  SelectItem,
  Button,
  Tag,
  SkeletonText,
  InlineNotification,
  Tile,
} from "@carbon/react";
import { api, type UserProfile } from "@/lib/api";
import { useSession } from "@/lib/session";

const CURRENCIES = ["EUR", "GBP", "USD"];

const EDITABLE_FIELDS: { key: keyof UserProfile; label: string }[] = [
  { key: "fname", label: "First name" },
  { key: "sname", label: "Surname" },
  { key: "phone_number", label: "Phone number" },
  { key: "occupation", label: "Occupation" },
  { key: "address_line1", label: "Address line 1" },
  { key: "city", label: "City" },
  { key: "postal_code", label: "Postal code" },
  { key: "country", label: "Country" },
];

export default function SettingsPage() {
  const router = useRouter();
  const { session, loading: sessionLoading } = useSession();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [form, setForm] = useState<Partial<UserProfile>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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
      .catch((err) => active && setError(err instanceof Error ? err.message : "Failed to load profile"))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [session, sessionLoading]);

  function update(key: keyof UserProfile, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  async function handleSave() {
    if (!session) return;
    setSaving(true);
    setError(null);
    try {
      // Send only the editable + currency fields.
      const payload: Partial<UserProfile> = { currency: form.currency };
      for (const { key } of EDITABLE_FIELDS) payload[key] = form[key] as never;
      const updated = await api.users.update(session.userId, payload);
      setProfile(updated);
      setForm(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
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
      <div>
        <h1 className="page-title">Settings</h1>
        <SkeletonText paragraph lineCount={6} />
      </div>
    );
  }

  const isBusinessOwner = session?.orgRole === "owner";

  return (
    <div style={{ maxWidth: "48rem" }}>
      <h1 className="page-title">Settings</h1>

      {error && <InlineNotification kind="error" title="Error" subtitle={error} lowContrast />}
      {saved && (
        <InlineNotification kind="success" title="Saved" subtitle="Your profile has been updated." lowContrast />
      )}

      <section className="section">
        <h2>Profile</h2>
        <div className="form-grid" style={{ marginTop: "1rem" }}>
          {EDITABLE_FIELDS.map(({ key, label }) => (
            <TextInput
              key={key}
              id={`profile-${key}`}
              labelText={label}
              value={(form[key] as string) ?? ""}
              onChange={(e) => update(key, e.target.value)}
            />
          ))}
          <TextInput id="profile-email" labelText="Email" value={profile?.email ?? ""} readOnly />
          <Select
            id="profile-currency"
            labelText="Currency"
            value={form.currency ?? "EUR"}
            onChange={(e) => update("currency", e.target.value)}
          >
            {CURRENCIES.map((c) => (
              <SelectItem key={c} value={c} text={c} />
            ))}
          </Select>
        </div>
        <Button onClick={handleSave} disabled={saving} style={{ marginTop: "1rem" }}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </section>

      <section className="section">
        <h2>Subscription</h2>
        <p style={{ marginTop: "0.5rem" }}>
          <Tag type="purple">{profile?.subscription_level ?? "Free"}</Tag>
          <span style={{ color: "var(--cds-text-secondary)", marginLeft: "0.5rem" }}>
            Manage your plan from a future release.
          </span>
        </p>
      </section>

      <section className="section">
        <h2>Data retention</h2>
        <p style={{ color: "var(--cds-text-secondary)" }}>
          Records are retained until… (retention policy is configured in a later phase.)
        </p>
      </section>

      {isBusinessOwner && (
        <section className="section">
          <h2>Client management</h2>
          <Tile>
            <p style={{ marginBottom: "0.75rem" }}>
              Manage the people in your organisation. Available in a later release.
            </p>
            <Button kind="tertiary" disabled>
              Manage clients
            </Button>
          </Tile>
        </section>
      )}

      <section className="section">
        <Button kind="danger--tertiary" onClick={handleLogout}>
          Log out
        </Button>
      </section>
    </div>
  );
}
