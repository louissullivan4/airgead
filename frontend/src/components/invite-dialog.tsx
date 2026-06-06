"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Spinner } from "@/components/ui/spinner";

interface InviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** Optional invite-type choices; when present a selector is shown. */
  kinds?: { label: string; value: string }[];
  /** Sends the invite; rejects with an Error whose message is shown to the user. */
  onInvite: (email: string, kind: string) => Promise<void>;
  onInvited?: () => void;
}

/** Single-email invite dialog shared by the Clients, Team and Admin workspaces. */
function InviteDialog({ open, onOpenChange, title, description, kinds, onInvite, onInvited }: InviteDialogProps) {
  const [email, setEmail] = useState("");
  const [kind, setKind] = useState(kinds?.[0]?.value ?? "");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    const value = email.trim();
    if (!value) return;
    setSubmitting(true);
    try {
      await onInvite(value, kind);
      toast.success("Invitation sent", { description: `We emailed ${value} an invite link.` });
      setEmail("");
      onOpenChange(false);
      onInvited?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send the invitation");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {kinds && kinds.length > 0 && (
            <Field label="Type" htmlFor="invite-kind">
              <Segmented
                value={kind}
                onValueChange={setKind}
                aria-label="Invite type"
                options={kinds}
              />
            </Field>
          )}
          <Field label="Email" htmlFor="invite-email">
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder="name@example.com"
            />
          </Field>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={submit} disabled={submitting || !email.trim()}>
            {submitting && <Spinner />}
            {submitting ? "Sending…" : "Send invite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { InviteDialog };
