"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Link2, Unplug } from "lucide-react";
import { api, type Organisation, type SageStatus } from "@/lib/api";
import { SAGE_ENABLED } from "@/lib/constants";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
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

const RETURN_COPY: Record<string, string> = {
  denied: "Sage connection was declined - nothing was linked.",
  state: "The connection attempt expired - please try again.",
  exchange: "Sage rejected the connection - please try again.",
  unconfigured: "Sage isn't configured on this server.",
};

/**
 * Settings card for the practice's Sage Business Cloud connection. Renders
 * nothing unless the feature flag is on AND the org is an accountancy
 * practice AND the backend agrees the feature exists (a 404 means the
 * backend flag is off - the frontend flag alone must not show a broken card).
 */
function SageCard({ isOwner, org }: { isOwner: boolean; org: Organisation | null }) {
  const router = useRouter();
  const [status, setStatus] = useState<SageStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  const isPractice = Boolean(org?.is_accountant_practice);

  const load = useCallback(() => {
    api.sage
      .status()
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (SAGE_ENABLED && isPractice) load();
  }, [isPractice, load]);

  // The OAuth round trip bounces back to /settings?sage=connected|error.
  useEffect(() => {
    if (!SAGE_ENABLED) return;
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("sage");
    if (!outcome) return;
    if (outcome === "connected") toast.success("Sage connected - you can now export clients to Sage.");
    if (outcome === "error") toast.error(RETURN_COPY[params.get("reason") ?? ""] ?? "Sage connection failed.");
    router.replace("/settings");
  }, [router]);

  if (!SAGE_ENABLED || !isPractice) return null;

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Sage</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-16 rounded-lg" />
        </CardContent>
      </Card>
    );
  }

  // A failed status call (backend flag off, or transient error): show nothing.
  if (!status) return null;

  async function connect() {
    setRedirecting(true);
    try {
      const { url } = await api.sage.connect();
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sage is unavailable right now.");
      setRedirecting(false);
    }
  }

  async function disconnect() {
    setConfirmingDisconnect(false);
    try {
      await api.sage.disconnect();
      toast.success("Sage disconnected.");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Disconnect failed.");
    }
  }

  const expired = status.connectionStatus === "expired";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sage</CardTitle>
        <CardDescription>
          {isOwner
            ? "Link your practice's Sage Business Cloud account to export client transactions."
            : "Only the owner can manage the Sage connection."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          {status.connected ? (
            <>
              <Badge variant={expired ? "destructive" : "default"}>
                {expired ? "Reconnect needed" : "Connected"}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {expired
                  ? "The connection has expired - reconnect to keep exporting."
                  : `Linked${status.connectedAt ? ` since ${new Date(status.connectedAt).toLocaleDateString()}` : ""}. Export clients from the Clients page.`}
              </span>
            </>
          ) : (
            <>
              <Badge variant="secondary">Not connected</Badge>
              <span className="text-sm text-muted-foreground">
                No Sage account linked yet.
              </span>
            </>
          )}
        </div>
        {isOwner && status.configured && (
          <div className="flex flex-wrap gap-3">
            {(!status.connected || expired) && (
              <Button onClick={connect} disabled={redirecting}>
                {redirecting ? <Spinner /> : <Link2 />}
                {expired ? "Reconnect Sage" : "Connect Sage"}
              </Button>
            )}
            {status.connected && (
              <Button variant="outline" onClick={() => setConfirmingDisconnect(true)}>
                <Unplug />
                Disconnect
              </Button>
            )}
          </div>
        )}
        {!status.configured && (
          <p className="text-xs text-muted-foreground">
            Sage isn&apos;t configured on this server yet - contact support.
          </p>
        )}
      </CardContent>

      <AlertDialog open={confirmingDisconnect} onOpenChange={setConfirmingDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Sage</AlertDialogTitle>
            <AlertDialogDescription>
              Exports to Sage will stop working until someone reconnects. This removes the stored
              connection here; to fully revoke access, also remove the app inside Sage.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={disconnect}>
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export { SageCard };
