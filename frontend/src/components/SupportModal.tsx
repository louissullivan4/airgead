"use client";

import { useState } from "react";
import {
  Modal,
  TextInput,
  TextArea,
  Select,
  SelectItem,
  InlineNotification,
} from "@carbon/react";
import { api } from "@/lib/api";

const ISSUE_TYPES = ["Question", "Bug", "Billing", "Feature request", "Other"];

export default function SupportModal({
  open,
  onClose,
  userEmail = "",
}: {
  open: boolean;
  onClose: () => void;
  userEmail?: string;
}) {
  const [email, setEmail] = useState(userEmail);
  const [issueType, setIssueType] = useState(ISSUE_TYPES[0]);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await api.users.support({
        userEmail: email,
        issueType,
        issueDescription: description,
      });
      setDone(true);
      setDescription("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send support request");
    } finally {
      setSubmitting(false);
    }
  }

  function close() {
    setDone(false);
    setError(null);
    onClose();
  }

  return (
    <Modal
      open={open}
      modalHeading="Contact support"
      primaryButtonText={done ? "Done" : submitting ? "Sending…" : "Send"}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={submitting || (!done && (!email || !description))}
      onRequestClose={close}
      onSecondarySubmit={close}
      onRequestSubmit={done ? close : handleSubmit}
    >
      {done ? (
        <InlineNotification
          kind="success"
          title="Sent"
          subtitle="Thanks — we'll get back to you by email."
          lowContrast
          hideCloseButton
        />
      ) : (
        <>
          {error && (
            <InlineNotification kind="error" title="Error" subtitle={error} lowContrast />
          )}
          <TextInput
            id="support-email"
            labelText="Your email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ marginBottom: "1rem" }}
          />
          <Select
            id="support-issue-type"
            labelText="Issue type"
            value={issueType}
            onChange={(e) => setIssueType(e.target.value)}
            style={{ marginBottom: "1rem" }}
          >
            {ISSUE_TYPES.map((t) => (
              <SelectItem key={t} value={t} text={t} />
            ))}
          </Select>
          <TextArea
            id="support-description"
            labelText="How can we help?"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </>
      )}
    </Modal>
  );
}
