"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CreditCard, ExternalLink } from "lucide-react";
import { api, type BillingStatus } from "@/lib/api";
import { PRICING } from "@/lib/pricing";
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

/** Human copy for the entitlement states the card can be in. */
function describe(status: BillingStatus): { badge: string; tone: "default" | "destructive"; line: string } {
  const daysLeft = status.trialEndsAt
    ? Math.max(0, Math.ceil((Date.parse(status.trialEndsAt) - Date.now()) / 86_400_000))
    : 0;
  switch (status.reason) {
    case "practice":
      return {
        badge: "Practice",
        tone: "default",
        line: `Your practice account is free - you pay ${PRICING.currency}${PRICING.practice.price}/month per active client seat.`,
      };
    case "covered_seat":
      return {
        badge: "Covered",
        tone: "default",
        line: "Your seat is covered by your accountant's practice - nothing for you to pay.",
      };
    case "subscribed":
      return status.status === "past_due"
        ? {
            badge: "Payment issue",
            tone: "destructive",
            line: "Your last payment failed - update your card to keep your subscription.",
          }
        : { badge: "Active", tone: "default", line: "Standard plan - thanks for subscribing." };
    case "trial":
      return {
        badge: "Trial",
        tone: "default",
        line: `Free trial - ${daysLeft === 1 ? "1 day" : `${daysLeft} days`} left. Everything stays if you subscribe.`,
      };
    default:
      return {
        badge: status.status === "canceled" ? "Canceled" : "Trial ended",
        tone: "destructive",
        line: "Your records are safe and always viewable - subscribe to keep adding new ones.",
      };
  }
}

/**
 * Settings billing card. While the platform has billing switched off
 * (enforced:false) it renders a simple early-access note; once enforced it
 * shows the live entitlement with checkout/portal actions for owners.
 */
function BillingCard({ isOwner }: { isOwner: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    let active = true;
    api.billing
      .status()
      .then((s) => active && setStatus(s))
      .catch(() => {})
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  // Stripe checkout bounces back to /settings?billing=success|canceled.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("billing");
    if (!outcome) return;
    if (outcome === "success") toast.success("Subscription started - you're all set.");
    if (outcome === "canceled") toast.info("Checkout canceled - nothing was charged.");
    router.replace("/settings");
  }, [router]);

  async function go(kind: "checkout" | "portal") {
    setRedirecting(true);
    try {
      const { url } = kind === "checkout" ? await api.billing.checkout() : await api.billing.portal();
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Billing is unavailable right now.");
      setRedirecting(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Plan &amp; billing</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-16 rounded-lg" />
        </CardContent>
      </Card>
    );
  }

  // Pre-GA: billing exists but is switched off platform-wide.
  if (!status || !status.enforced) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Plan &amp; billing</CardTitle>
          <CardDescription>
            Free during early access. When billing launches you&apos;ll get a{" "}
            {status?.trialDays ?? 30}-day free trial before anything is charged.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Badge variant="secondary">Early access</Badge>
          <span className="text-sm text-muted-foreground">Everything included, no card required.</span>
        </CardContent>
      </Card>
    );
  }

  const d = describe(status);
  // Which action makes sense: manage an existing Stripe relationship, start
  // one, or both (a canceled org restarts with a fresh checkout).
  const hasStripeHistory = status.billingStatus !== "none";
  const canRestart = !status.active && status.reason === "expired";
  const showSubscribe =
    status.configured &&
    isOwner &&
    status.reason !== "covered_seat" &&
    (!hasStripeHistory || canRestart);
  const showManage = status.configured && isOwner && hasStripeHistory;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plan &amp; billing</CardTitle>
        <CardDescription>
          {isOwner ? "Manage your subscription." : "Only the owner can change billing."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={d.tone === "destructive" ? "destructive" : "default"}>{d.badge}</Badge>
          <span className="text-sm text-muted-foreground">{d.line}</span>
        </div>
        {status.isPractice && status.seatCount !== undefined && (
          <p className="text-sm text-muted-foreground">
            {status.seatCount === 1 ? "1 active client seat" : `${status.seatCount} active client seats`} -
            seats update automatically as you invite or revoke clients.
          </p>
        )}
        {(showSubscribe || showManage) && (
          <div className="flex flex-wrap gap-3">
            {showSubscribe && (
              <Button onClick={() => go("checkout")} disabled={redirecting}>
                {redirecting ? <Spinner /> : <CreditCard />}
                {status.isPractice
                  ? "Set up practice billing"
                  : `Subscribe - ${PRICING.currency}${PRICING.solo.price}/month`}
              </Button>
            )}
            {showManage && (
              <Button variant="outline" onClick={() => go("portal")} disabled={redirecting}>
                {redirecting ? <Spinner /> : <ExternalLink />}
                Manage billing
              </Button>
            )}
          </div>
        )}
        {!status.configured && isOwner && (
          <p className="text-xs text-muted-foreground">
            Online payment isn&apos;t available yet - contact support to subscribe.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export { BillingCard };
