"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

const ISSUE_TYPES = ["Question", "Bug", "Billing", "Feature request", "Other"];

interface SupportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userEmail?: string;
}

function SupportDialog({ open, onOpenChange, userEmail }: SupportDialogProps) {
  const [email, setEmail] = useState(userEmail ?? "");
  const [issueType, setIssueType] = useState<string>(ISSUE_TYPES[0]);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (userEmail) setEmail(userEmail);
  }, [userEmail]);

  async function submit() {
    if (!email || !description.trim()) return;
    setSubmitting(true);
    try {
      await api.users.support({ userEmail: email, issueType, issueDescription: description });
      toast.success("Message sent", { description: "We'll get back to you by email." });
      setDescription("");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send your message");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Contact support</DialogTitle>
          <DialogDescription>
            Tell us what&apos;s going on and we&apos;ll reply by email.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="Email" htmlFor="support-email">
            <Input
              id="support-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </Field>
          <Field label="Topic" htmlFor="support-topic">
            <Select value={issueType} onValueChange={setIssueType}>
              <SelectTrigger id="support-topic">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ISSUE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Message" htmlFor="support-message">
            <Textarea
              id="support-message"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the issue or question…"
            />
          </Field>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button vaairgeadt="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={submit} disabled={submitting || !email || !description.trim()}>
            {submitting && <Spinner />}
            {submitting ? "Sending…" : "Send message"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { SupportDialog };
