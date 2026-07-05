"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Building2, Check, Clock, MoreHorizontal, Search, ShieldCheck, UserPlus, Users, X } from "lucide-react";
import { toast } from "sonner";
import {
  api,
  formatCurrency,
  type AdminOrg,
  type AdminUser,
  type PlatformStats,
  type PracticeApplication,
} from "@/lib/api";
import { useSession } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { InviteDialog } from "@/components/invite-dialog";
import { StatCard, StatGrid } from "@/components/stat-card";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const num = (v: string | number) => Number(v) || 0;

type Confirm = {
  title: string;
  body: string;
  action: () => Promise<void>;
  /** Confirm-button label; defaults to a destructive "Delete permanently". */
  confirmLabel?: string;
  destructive?: boolean;
};

export default function AdminPage() {
  const { session } = useSession();
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [orgs, setOrgs] = useState<AdminOrg[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [applications, setApplications] = useState<PracticeApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, o, u, a] = await Promise.all([
        api.admin.overview(),
        api.admin.orgs(),
        api.admin.users(),
        api.admin.practiceApplications(),
      ]);
      setStats(s);
      setOrgs(o);
      setUsers(u);
      setApplications(a);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load platform data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Run a mutating action, surface errors, and refresh.
  const run = useCallback(
    async (fn: () => Promise<unknown>, ok: string) => {
      try {
        await fn();
        toast.success(ok);
        void load();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Action failed");
      }
    },
    [load],
  );

  async function runConfirm() {
    if (!confirm) return;
    setWorking(true);
    try {
      await confirm.action();
    } finally {
      setWorking(false);
      setConfirm(null);
    }
  }

  const q = search.trim().toLowerCase();
  const filteredOrgs = useMemo(
    () => (q ? orgs.filter((o) => o.name.toLowerCase().includes(q)) : orgs),
    [orgs, q],
  );
  const filteredUsers = useMemo(
    () =>
      q
        ? users.filter(
            (u) =>
              `${u.fname} ${u.sname}`.toLowerCase().includes(q) ||
              u.email.toLowerCase().includes(q) ||
              (u.org_name ?? "").toLowerCase().includes(q),
          )
        : users,
    [users, q],
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Admin" description="Platform overview." />
        <StatGrid>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </StatGrid>
        <Skeleton className="h-72 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Admin" />
        <Card className="p-10 text-center text-sm text-destructive">{error}</Card>
      </div>
    );
  }

  const net = stats ? num(stats.income_total) - num(stats.expense_total) : 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Admin" description="Every organisation and user on the platform.">
        <Button onClick={() => setInviteOpen(true)}>
          <UserPlus />
          Invite
        </Button>
      </PageHeader>

      <StatGrid>
        <StatCard label="Organisations" value={String(num(stats?.orgs ?? 0))} icon={Building2} />
        <StatCard label="Users" value={String(num(stats?.users ?? 0))} icon={Users} />
        <StatCard label="Firms" value={String(num(stats?.firms ?? 0))} icon={ShieldCheck} hint={`${num(stats?.clients ?? 0)} linked clients`} />
        <StatCard label="Net this year" value={formatCurrency(net)} tone={net >= 0 ? "success" : "destructive"} hint={`${num(stats?.txns ?? 0)} transactions`} />
      </StatGrid>

      <div className="relative w-full sm:max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search orgs or users"
          className="pl-9"
        />
      </div>

      {/* Practice applications - accountancy firms awaiting approval. */}
      {applications.length > 0 && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <Clock className="size-4" />
            Practice applications
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-500">
              {applications.length} pending
            </span>
          </h2>
          <Card className="divide-y divide-border/60">
            {applications.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="font-medium">{a.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {[`${a.fname ?? ""} ${a.sname ?? ""}`.trim(), a.owner_email, a.country]
                      .filter(Boolean)
                      .join(" · ")}
                    {a.vat_number ? ` · VAT ${a.vat_number}` : ""}
                  </p>
                  {a.description && (
                    <p className="mt-1 text-xs text-muted-foreground">{a.description}</p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      run(() => api.admin.setPracticeApproval(a.id, "approved"), `${a.name} approved`)
                    }
                  >
                    <Check />
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setConfirm({
                        title: `Reject ${a.name}?`,
                        body: "The applicant is emailed that their practice wasn't approved. They keep a normal account and can be approved later.",
                        confirmLabel: "Reject practice",
                        destructive: false,
                        action: () =>
                          run(() => api.admin.setPracticeApproval(a.id, "rejected"), `${a.name} rejected`),
                      })
                    }
                  >
                    <X />
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </Card>
        </section>
      )}

      {/* Organisations */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">Organisations</h2>
        <Card className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-xs font-medium text-muted-foreground">
                <th className="px-3 py-2.5 text-left">Name</th>
                <th className="px-3 py-2.5 text-left">Type</th>
                <th className="px-3 py-2.5 text-right">Members</th>
                <th className="px-3 py-2.5 text-right">Net</th>
                <th className="px-3 py-2.5 text-left">Status</th>
                <th className="w-10 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {filteredOrgs.map((o) => {
                const oNet = num(o.income_total) - num(o.expense_total);
                const suspended = o.status === "suspended";
                const isSelf = o.id === session?.orgId;
                return (
                  <tr key={o.id} className="border-b border-border/60 hover:bg-accent/40">
                    <td className="px-3 py-3">
                      <Link href={`/clients/${o.id}`} className="font-medium hover:underline">
                        {o.name}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {o.is_accountant_practice
                        ? "Firm"
                        : o.practice_status === "pending"
                          ? "Firm (pending)"
                          : o.type}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                      {num(o.member_count)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatCurrency(oNet)}</td>
                    <td className="px-3 py-3">
                      <StatusTag suspended={suspended} />
                    </td>
                    <td className="px-3 py-3 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label="Org actions">
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link href={`/clients/${o.id}`}>Open</Link>
                          </DropdownMenuItem>
                          {!isSelf && (
                            <>
                              <DropdownMenuItem
                                onSelect={() =>
                                  run(
                                    () => api.admin.setOrgStatus(o.id, suspended ? "active" : "suspended"),
                                    suspended ? "Organisation reactivated" : "Organisation suspended",
                                  )
                                }
                              >
                                {suspended ? "Reactivate" : "Suspend"}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() =>
                                  setConfirm({
                                    title: `Delete ${o.name}?`,
                                    body: "Permanently erases the organisation, all its users and their data, and stored receipts. This cannot be undone.",
                                    action: () =>
                                      run(() => api.admin.deleteOrg(o.id), "Organisation deleted"),
                                  })
                                }
                              >
                                Delete permanently
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </section>

      {/* Users */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">Users</h2>
        <Card className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-xs font-medium text-muted-foreground">
                <th className="px-3 py-2.5 text-left">Name</th>
                <th className="px-3 py-2.5 text-left">Email</th>
                <th className="px-3 py-2.5 text-left">Organisation</th>
                <th className="px-3 py-2.5 text-left">Platform</th>
                <th className="px-3 py-2.5 text-left">Status</th>
                <th className="w-10 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((u) => {
                const suspended = u.account_status === "suspended";
                const isSuper = u.platform_role === "super_admin";
                const isSelf = u.id === session?.userId;
                return (
                  <tr key={u.id} className="border-b border-border/60 hover:bg-accent/40">
                    <td className="px-3 py-3 font-medium">
                      {`${u.fname} ${u.sname}`.trim()}
                      {isSelf && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{u.email}</td>
                    <td className="px-3 py-3 text-muted-foreground">{u.org_name ?? "-"}</td>
                    <td className="px-3 py-3">
                      {isSuper ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                          <ShieldCheck className="size-3" /> super admin
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">{u.org_role}</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <StatusTag suspended={suspended} />
                    </td>
                    <td className="px-3 py-3 text-right">
                      {!isSelf && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label="User actions">
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={() =>
                                run(
                                  () =>
                                    api.admin.setUserPlatformRole(u.id, isSuper ? "user" : "super_admin"),
                                  isSuper ? "Super admin revoked" : "Super admin granted",
                                )
                              }
                            >
                              {isSuper ? "Revoke super admin" : "Grant super admin"}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() =>
                                run(
                                  () => api.admin.setUserStatus(u.id, suspended ? "active" : "suspended"),
                                  suspended ? "User reactivated" : "User suspended",
                                )
                              }
                            >
                              {suspended ? "Reactivate" : "Suspend"}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() =>
                                setConfirm({
                                  title: `Delete ${u.fname} ${u.sname}?`.trim(),
                                  body: "Permanently erases this user and their data (and their organisation if they solely own it). This cannot be undone.",
                                  action: () => run(() => api.admin.deleteUser(u.id), "User deleted"),
                                })
                              }
                            >
                              Delete permanently
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </section>

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        title="Invite to the platform"
        description="A regular user gets their own account; an accountant gets a firm they can build a client book in."
        kinds={[
          { label: "Regular user", value: "user" },
          { label: "Accountant", value: "accountant" },
        ]}
        onInvite={(email, kind) => api.admin.invite(email, kind as "user" | "accountant")}
      />

      <AlertDialog open={Boolean(confirm)} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={confirm?.destructive === false ? "primary" : "destructive"}
              disabled={working}
              onClick={runConfirm}
            >
              {confirm?.confirmLabel ?? "Delete permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatusTag({ suspended }: { suspended: boolean }) {
  return (
    <span
      className={
        suspended
          ? "inline-flex items-center rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
          : "inline-flex items-center rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success"
      }
    >
      {suspended ? "Suspended" : "Active"}
    </span>
  );
}
