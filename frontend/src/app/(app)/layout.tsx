"use client";

import { useEffect, useState, type ReactNode } from "react";
import { api, type Organisation, type UserProfile } from "@/lib/api";
import { useSession } from "@/lib/session";
import { AppSidebar } from "@/components/app-sidebar";
import { MobileBottomNav, MobileTopBar } from "@/components/mobile-nav";
import { SupportDialog } from "@/components/support-dialog";

export default function AppLayout({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [org, setOrg] = useState<Organisation | null>(null);
  const [supportOpen, setSupportOpen] = useState(false);

  useEffect(() => {
    if (!session) return;
    let active = true;
    api.users
      .getById(session.userId)
      .then((p) => active && setProfile(p))
      .catch(() => {});
    api.organisations
      .get(session.orgId)
      .then((o) => active && setOrg(o))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [session]);

  const name = profile ? `${profile.fname} ${profile.sname}`.trim() : undefined;
  const email = profile?.email;
  const onSupport = () => setSupportOpen(true);

  // Nav gating (hidden entirely for solo personal users):
  //  - Clients: accountancy practice orgs, or platform super_admins.
  //  - Team: owners of a business org (members roll up to it).
  const isSuperAdmin = session?.platformRole === "super_admin";
  const showClients = Boolean(org?.is_accountant_practice) || isSuperAdmin;
  const showTeam = org?.type === "business" && session?.orgRole === "owner";

  return (
    <div className="min-h-dvh">
      <AppSidebar
        name={name}
        email={email}
        onSupport={onSupport}
        showClients={showClients}
        showTeam={showTeam}
        showAdmin={isSuperAdmin}
      />
      <MobileTopBar name={name} email={email} onSupport={onSupport} />

      <main className="px-4 pb-24 pt-5 sm:px-6 lg:ml-64 lg:px-10 lg:pb-12 lg:pt-9">
        <div className="mx-auto w-full max-w-5xl">{children}</div>
      </main>

      <MobileBottomNav onSupport={onSupport} />
      <SupportDialog open={supportOpen} onOpenChange={setSupportOpen} userEmail={email} />
    </div>
  );
}
