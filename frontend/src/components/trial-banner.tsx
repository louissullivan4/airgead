"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Clock } from "lucide-react";
import { api, type BillingStatus } from "@/lib/api";

const WARN_DAYS = 7;

/**
 * Trial/expiry banner shown across the app (mounted in the app layout).
 * Renders nothing while billing isn't enforced (the backend says so), for
 * paid/covered/practice orgs, and for trials with plenty of runway - it only
 * speaks up in the last week and after expiry.
 */
function TrialBanner() {
  const [status, setStatus] = useState<BillingStatus | null>(null);

  useEffect(() => {
    let active = true;
    api.billing
      .status()
      .then((s) => active && setStatus(s))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (!status || !status.enforced) return null;
  // Paid, covered by a practice, or a practice itself - nothing to nag about.
  if (status.active && status.reason !== "trial") return null;

  const daysLeft = status.trialEndsAt
    ? Math.max(0, Math.ceil((Date.parse(status.trialEndsAt) - Date.now()) / 86_400_000))
    : 0;

  if (status.active) {
    if (daysLeft > WARN_DAYS) return null;
    return (
      <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
        <Clock className="size-4 shrink-0 text-amber-600 dark:text-amber-500" />
        <span>
          Your free trial ends in <strong>{daysLeft === 1 ? "1 day" : `${daysLeft} days`}</strong>.
        </span>
        <Link href="/settings" className="font-medium underline underline-offset-2 hover:no-underline">
          Subscribe in Settings
        </Link>
      </div>
    );
  }

  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
      <AlertTriangle className="size-4 shrink-0 text-destructive" />
      <span>
        Your trial has ended - your records are safe and always viewable, but adding new ones is
        paused.
      </span>
      <Link href="/settings" className="font-medium underline underline-offset-2 hover:no-underline">
        Subscribe to continue
      </Link>
    </div>
  );
}

export { TrialBanner };
