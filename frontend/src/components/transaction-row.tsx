import * as React from "react";
import { Receipt } from "lucide-react";
import { amountOf, isIncome, type Expense } from "@/lib/api";
import { categoryMeta } from "@/lib/categories";
import { cn } from "@/lib/utils";
import { Amount } from "./amount";
import { CategoryIcon } from "./category-badge";

interface TransactionRowProps {
  expense: Expense;
  currency: string;
  onClick?: () => void;
  /** Trailing element (e.g. a kebab menu), outside the clickable area. */
  action?: React.ReactNode;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function TransactionRow({ expense, currency, onClick, action }: TransactionRowProps) {
  const income = isIncome(expense);
  const meta = categoryMeta(expense.category);
  const hasReceipt = Boolean(expense.receipt_id) || Boolean(expense.receipt_image_url);
  const Body = onClick ? "button" : "div";

  return (
    <div className="group flex items-center gap-1">
      <Body
        type={onClick ? "button" : undefined}
        onClick={onClick}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-2.5 text-left outline-none",
          onClick && "transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <CategoryIcon category={expense.category} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">
              {expense.title || expense.merchant_name || meta.label}
            </span>
            {hasReceipt && (
              <Receipt
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-label="Has receipt"
              />
            )}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {expense.merchant_name && expense.title ? `${expense.merchant_name} · ` : ""}
            {meta.label} · {formatDate(expense.created_at)}
          </div>
        </div>
        <Amount value={amountOf(expense)} currency={currency} income={income} className="text-sm" />
      </Body>
      {action}
    </div>
  );
}

export { TransactionRow };
