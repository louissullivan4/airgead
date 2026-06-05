"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface ReceiptThumbProps {
  expenseId: string;
  hasReceipt: boolean;
  className?: string;
}

/** Lazily resolves a short-lived signed URL and shows the receipt thumbnail. */
function ReceiptThumb({ expenseId, hasReceipt, className }: ReceiptThumbProps) {
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

  if (!hasReceipt) {
    return <span className={cn("text-muted-foreground/50", className)}>—</span>;
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
