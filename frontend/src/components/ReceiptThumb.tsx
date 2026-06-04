"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

// Lazily resolves a short-lived signed URL for an expense's receipt. Only the
// rows currently on screen mount this, so we don't fetch URLs for the whole table.
export default function ReceiptThumb({
  expenseId,
  hasReceipt,
}: {
  expenseId: string;
  hasReceipt: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!hasReceipt) return;
    let active = true;
    api.expenses
      .getReceiptUrl(expenseId)
      .then((r) => active && setUrl(r.url))
      .catch(() => active && setUrl(null));
    return () => {
      active = false;
    };
  }, [expenseId, hasReceipt]);

  if (!hasReceipt) return <span style={{ color: "var(--cds-text-secondary)" }}>—</span>;
  if (!url) return <span style={{ color: "var(--cds-text-secondary)" }}>…</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="receipt-thumb" src={url} alt="Receipt" />
    </a>
  );
}
