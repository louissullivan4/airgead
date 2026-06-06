"use client";

import { useCallback, useEffect, useState } from "react";
import { UserPlus, UsersRound } from "lucide-react";
import { api, type OrgMember } from "@/lib/api";
import { useSession } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { InviteDialog } from "@/components/invite-dialog";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

export default function TeamPage() {
  const { session } = useSession();
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [isFirm, setIsFirm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  // Firms call their members "accountants"; regular business orgs say "team".
  const noun = isFirm ? "accountant" : "member";
  const heading = isFirm ? "Accountants" : "Team";

  const load = useCallback(async (orgId: string) => {
    setLoading(true);
    try {
      setMembers(await api.organisations.members(orgId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load team");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    void load(session.orgId);
    api.organisations
      .get(session.orgId)
      .then((o) => setIsFirm(Boolean(o.is_accountant_practice)))
      .catch(() => {});
  }, [session, load]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={heading}
        description={
          isFirm
            ? "Accountants in your firm. Each manages the clients they invite."
            : "Everyone in your organisation. What members submit rolls up to the org."
        }
      >
        <Button onClick={() => setInviteOpen(true)}>
          <UserPlus />
          Invite {noun}
        </Button>
      </PageHeader>

      {loading ? (
        <Card className="space-y-3 p-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </Card>
      ) : error ? (
        <Card className="p-10 text-center text-sm text-destructive">{error}</Card>
      ) : members.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title={isFirm ? "No accountants yet" : "No team members yet"}
          description={
            isFirm
              ? "Invite an accountant to your firm to share the client book."
              : "Invite someone to submit expenses under your organisation."
          }
          action={
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlus />
              Invite {noun}
            </Button>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-xs font-medium text-muted-foreground">
                <th className="px-3 py-2.5 text-left">Name</th>
                <th className="px-3 py-2.5 text-left">Email</th>
                <th className="px-3 py-2.5 text-left">Role</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-b border-border/60">
                  <td className="px-3 py-3 font-medium">{`${m.fname} ${m.sname}`.trim()}</td>
                  <td className="px-3 py-3 text-muted-foreground">{m.email}</td>
                  <td className="px-3 py-3">
                    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium capitalize text-muted-foreground">
                      {m.org_role}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        title={isFirm ? "Invite an accountant" : "Invite a team member"}
        description={
          isFirm
            ? "They'll join your firm and can invite and manage their own clients."
            : "They'll join your organisation; everything they submit rolls up to it."
        }
        onInvite={(email) => {
          if (!session) throw new Error("Session expired");
          return api.organisations.inviteMember(session.orgId, email);
        }}
        onInvited={() => session && load(session.orgId)}
      />
    </div>
  );
}
