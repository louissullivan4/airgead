import * as React from "react";
import type { Expense } from "@/lib/api";
import { cn } from "@/lib/utils";
import { TransactionRow } from "./transaction-row";

interface TransactionListProps {
  expenses: Expense[];
  currency: string;
  onSelect?: (expense: Expense) => void;
  renderAction?: (expense: Expense) => React.ReactNode;
  className?: string;
}

/** Shared row list used by the dashboard recent activity and mobile Transactions. */
function TransactionList({
  expenses,
  currency,
  onSelect,
  renderAction,
  className,
}: TransactionListProps) {
  return (
    <ul className={cn("divide-y divide-border", className)}>
      {expenses.map((expense) => (
        <li key={expense.id}>
          <TransactionRow
            expense={expense}
            currency={currency}
            onClick={onSelect ? () => onSelect(expense) : undefined}
            action={renderAction?.(expense)}
          />
        </li>
      ))}
    </ul>
  );
}

export { TransactionList };
