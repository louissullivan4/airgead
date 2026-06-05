"use client";

import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { amountOf, isIncome, type Expense } from "@/lib/api";
import { categoryMeta } from "@/lib/categories";
import { cn } from "@/lib/utils";
import { Amount } from "./amount";
import { CategoryBadge } from "./category-badge";
import { ReceiptThumb } from "./receipt-thumb";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type SortKey = "title" | "category" | "date" | "amount";
export type SortDir = "asc" | "desc";

interface TransactionsTableProps {
  expenses: Expense[];
  currency: string;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  onEdit: (expense: Expense) => void;
  onDelete: (expense: Expense) => void;
}

function TransactionsTable({
  expenses,
  currency,
  sortKey,
  sortDir,
  onSort,
  onEdit,
  onDelete,
}: TransactionsTableProps) {
  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return <ChevronsUpDown className="size-3.5 opacity-50" />;
    return sortDir === "asc" ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />;
  };

  const headerButton = (label: string, key: SortKey) => (
    <button
      type="button"
      onClick={() => onSort(key)}
      className="inline-flex items-center gap-1 font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      {label}
      {sortIcon(key)}
    </button>
  );

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-border">
          <th className="px-3 py-2.5 text-left text-xs">{headerButton("Title", "title")}</th>
          <th className="px-3 py-2.5 text-left text-xs">{headerButton("Category", "category")}</th>
          <th className="px-3 py-2.5 text-left text-xs">{headerButton("Date", "date")}</th>
          <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">
            Receipt
          </th>
          <th className="px-3 py-2.5 text-right text-xs">
            <span className="inline-flex justify-end">{headerButton("Amount", "amount")}</span>
          </th>
          <th className="w-10 px-3 py-2.5" />
        </tr>
      </thead>
      <tbody>
        {expenses.map((e) => (
          <tr key={e.id} className="border-b border-border/60 transition-colors hover:bg-accent/40">
            <td className="max-w-0 truncate px-3 py-3 font-medium">
              {e.title || e.merchant_name || categoryMeta(e.category).label}
              {e.merchant_name && e.title && (
                <span className="block truncate text-xs font-normal text-muted-foreground">
                  {e.merchant_name}
                </span>
              )}
            </td>
            <td className="px-3 py-3">
              <CategoryBadge category={e.category} />
            </td>
            <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">
              {new Date(e.created_at).toLocaleDateString()}
            </td>
            <td className="px-3 py-3">
              <ReceiptThumb
                expenseId={e.id}
                hasReceipt={Boolean(e.receipt_image_url)}
                receiptId={e.receipt_id}
              />
            </td>
            <td className="whitespace-nowrap px-3 py-3 text-right">
              <Amount value={amountOf(e)} currency={currency} income={isIncome(e)} />
            </td>
            <td className="px-3 py-3 text-right">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Row actions">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => onEdit(e)}>
                    <Pencil />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onSelect={() => onDelete(e)}>
                    <Trash2 />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export { TransactionsTable };
