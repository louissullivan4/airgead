import { formatCurrency } from "@/lib/api";
import { cn } from "@/lib/utils";

interface AmountProps {
  value: number;
  currency?: string;
  /** Income renders green with a leading +. */
  income?: boolean;
  /** Show the +/− sign prefix (default true). */
  signed?: boolean;
  className?: string;
}

/** Consistent currency rendering: tabular figures, signed, income in green. */
function Amount({ value, currency = "EUR", income = false, signed = true, className }: AmountProps) {
  return (
    <span className={cn("font-medium tabular-nums", income && "text-success", className)}>
      {signed ? (income ? "+" : "−") : null}
      {formatCurrency(value, currency)}
    </span>
  );
}

export { Amount };
