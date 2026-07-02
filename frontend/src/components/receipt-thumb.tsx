"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface ReceiptThumbProps {
  expenseId: string;
  /** True when the expense carries its own (legacy) receipt_image_url. */
  hasReceipt: boolean;
  /** Set when the expense is a line item of a shared, captured receipt (Phase 2). */
  receiptId?: string | null;
  className?: string;
}

/**
 * Lazily resolves a short-lived signed URL and shows the receipt thumbnail.
 * Prefers the shared receipt image (Phase 2 `receipt_id`) when present, falling
 * back to the legacy per-expense `receipt_image_url`.
 */
function ReceiptThumb({ expenseId, hasReceipt, receiptId, className }: ReceiptThumbProps) {
  const [url, setUrl] = useState<string | null>(null);
  const present = Boolean(receiptId) || hasReceipt;

  useEffect(() => {
    if (!present) return;
    let active = true;
    const fetchUrl = receiptId
      ? api.receipts.getImageUrl(receiptId)
      : api.expenses.getReceiptUrl(expenseId);
    fetchUrl
      .then((r) => active && setUrl(r.url))
      .catch(() => active && setUrl(null));
    return () => {
      active = false;
    };
  }, [expenseId, receiptId, present]);

  if (!present) {
    return <span className={cn("text-muted-foreground/50", className)}>-</span>;
  }
  if (!url) {
    return (
      <span
        className={cn("inline-block size-9 animate-pulse rounded-md bg-muted", className)}
        aria-label="Loading receipt"
      />
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("inline-block", className)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt="Receipt"
        className="size-9 rounded-md border border-border object-cover transition hover:opacity-80"
      />
    </a>
  );
}

export { ReceiptThumb };
