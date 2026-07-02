"use client";

import { useState } from "react";
import { MailWarning } from "lucide-react";
import { toast } from "sonner";
import { api, type UserProfile } from "@/lib/api";

/**
 * Gentle in-app nudge while an account's email is unverified (the 7-day login
 * grace window). Renders nothing once verified - and nothing on backends that
 * predate the column (field undefined rather than null).
 */
function VerifyEmailBanner({ profile }: { profile: UserProfile | null }) {
  const [resending, setResending] = useState(false);
  const [sent, setSent] = useState(false);

  if (!profile || profile.email_verified_at !== null) return null;

  async function handleResend() {
    if (!profile) return;
    setResending(true);
    try {
      await api.users.resendVerification(profile.email);
      setSent(true);
      toast.success("Verification link sent - check your inbox.");
    } catch {
      toast.error("Could not send the link - please try again shortly.");
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
      <MailWarning className="size-4 shrink-0 text-amber-600 dark:text-amber-500" />
      <span>
        Please verify your email address - we sent a link to <strong>{profile.email}</strong>.
      </span>
      {!sent && (
        <button
          type="button"
          onClick={handleResend}
          disabled={resending}
          className="font-medium underline underline-offset-2 hover:no-underline disabled:opacity-60"
        >
          {resending ? "Sending…" : "Resend link"}
        </button>
      )}
    </div>
  );
}

export { VerifyEmailBanner };
