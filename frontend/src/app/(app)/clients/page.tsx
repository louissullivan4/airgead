"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Briefcase, Download, MoreHorizontal, Search, UserCog, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { api, formatCurrency, type ClientSummary, type OrgMember } from "@/lib/api";
import { useSession } from "@/lib/session";
import { ORG_CATEGORIES } from "@/lib/org";
import { PageHeader } from "@/components/page-header";
import { InviteDialog } from "@/components/invite-dialog";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { Field } from "@/components/ui/field";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

const TAX_YEAR = new Date().getFullYear();

const orgCategoryLabel = (slug: string) =>
  ORG_CATEGORIES.find((c) => c.slug === slug)?.label ?? slug;

const num = (v: string | number) => Number(v) || 0;

export default function ClientsPage() {
  const { session } = useSession();
  // Firm admin (org owner) or super_admin sees all clients + can reassign.
  const isAdmin = session?.orgRole === "owner" || session?.platformRole === "super_admin";

  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [revoking, setRevoking] = useState<ClientSummary | null>(null);

  // Reassignment (admin only).
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [reassigning, setReassigning] = useState<ClientSummary | null>(null);
  const [assignTo, setAssignTo] = useState<string>("");
  const [savingAssign, setSavingAssign] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setClients(await api.accountant.listClients());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load clients");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Admins need the firm roster to reassign clients between accountants.
  useEffect(() => {
    if (isAdmin && session) {
      api.organisations.members(session.orgId).then(setMembers).catch(() => {});
    }
  }, [isAdmin, session]);

  async function confirmReassign() {
    if (!reassigning || !assignTo) return;
    setSavingAssign(true);
    try {
      await api.accountant.assignClient(reassigning.id, assignTo);
      toast.success("Client reassigned");
      setReassigning(null);
      setAssignTo("");
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reassign failed");
    } finally {
      setSavingAssign(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (c) =>
        c.name.toLowerCase().includes(q) || orgCategoryLabel(c.org_category).toLowerCase().includes(q),
    );
  }, [clients, search]);

  async function exportClient(c: ClientSummary) {
    try {
      const blob = await api.accountant.exportClient(c.id, TAX_YEAR, "zip");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${c.name.replace(/[^a-z0-9]+/gi, "_")}_${TAX_YEAR}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    }
  }

  async function confirmRevoke() {
    if (!revoking) return;
    const target = revoking;
    setRevoking(null);
    try {
      await api.accountant.revokeClient(target.id);
      toast.success("Access revoked", { description: `You no longer have access to ${target.name}.` });
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Revoke failed");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Clients" description="The organisations your practice oversees.">
        <Button onClick={() => setInviteOpen(true)}>
          <UserPlus />
          Invite client
        </Button>
      </PageHeader>

      <div className="relative w-full sm:max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search clients"
          className="pl-9"
        />
      </div>

      {loading ? (
        <Card className="space-y-3 p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </Card>
      ) : error ? (
        <Card className="p-10 text-center text-sm text-destructive">{error}</Card>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title={search ? "No matching clients" : "No clients yet"}
          description={
            search
              ? "Try a different search."
              : "Invite your first client to manage their books alongside yours."
          }
          action={
            search ? undefined : (
              <Button onClick={() => setInviteOpen(true)}>
                <UserPlus />
                Invite client
              </Button>
            )
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-xs font-medium text-muted-foreground">
                <th className="px-3 py-2.5 text-left">Client</th>
                {isAdmin && <th className="px-3 py-2.5 text-left">Accountant</th>}
                <th className="px-3 py-2.5 text-right">Expense</th>
                <th className="px-3 py-2.5 text-right">Income</th>
                <th className="px-3 py-2.5 text-right">Net</th>
                <th className="px-3 py-2.5 text-right">Txns</th>
                <th className="px-3 py-2.5 text-left">Last activity</th>
                <th className="w-10 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const net = num(c.income_total) - num(c.expense_total);
                return (
                  <tr
                    key={c.id}
                    className="border-b border-border/60 transition-colors hover:bg-accent/40"
                  >
                    <td className="px-3 py-3">
                      <Link href={`/clients/${c.id}`} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                      <span className="ml-2 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
                        {orgCategoryLabel(c.org_category)}
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">
                        {c.owner_name ?? "—"}
                      </td>
                    )}
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                      {formatCurrency(num(c.expense_total))}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-success">
                      {formatCurrency(num(c.income_total))}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-medium tabular-nums">
                      {formatCurrency(net)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-muted-foreground">
                      {num(c.txn_count)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">
                      {c.last_activity ? new Date(c.last_activity).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label="Client actions">
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link href={`/clients/${c.id}`}>Open</Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => exportClient(c)}>
                            <Download />
                            Export
                          </DropdownMenuItem>
                          {isAdmin && (
                            <DropdownMenuItem
                              onSelect={() => {
                                setAssignTo(c.created_by ?? "");
                                setReassigning(c);
                              }}
                            >
                              <UserCog />
                              Reassign
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem variant="destructive" onSelect={() => setRevoking(c)}>
                            Revoke access
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        title="Invite a client"
        description="They'll create their own organisation and it will appear here for you to oversee."
        onInvite={(email) => {
          if (!session) throw new Error("Session expired");
          return api.accountant.inviteClient(session.orgId, email);
        }}
      />

      <Dialog
        open={Boolean(reassigning)}
        onOpenChange={(o) => {
          if (!o) {
            setReassigning(null);
            setAssignTo("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reassign client</DialogTitle>
            <DialogDescription>
              Choose which accountant owns &ldquo;{reassigning?.name}&rdquo;.
            </DialogDescription>
          </DialogHeader>
          <Field label="Accountant" htmlFor="reassign-accountant">
            <Select value={assignTo} onValueChange={setAssignTo}>
              <SelectTrigger id="reassign-accountant">
                <SelectValue placeholder="Select an accountant" />
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {`${m.fname} ${m.sname}`.trim()} {m.org_role === "owner" ? "(admin)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={confirmReassign} disabled={savingAssign || !assignTo}>
              {savingAssign && <Spinner />}
              {savingAssign ? "Saving…" : "Reassign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(revoking)} onOpenChange={(o) => !o && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke access</AlertDialogTitle>
            <AlertDialogDescription>
              Remove your practice&apos;s access to &ldquo;{revoking?.name}&rdquo;? Their own data is
              unaffected, and you can be re-invited later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmRevoke}>
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
