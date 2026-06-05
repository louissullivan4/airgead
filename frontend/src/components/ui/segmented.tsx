"use client";

import { cn } from "@/lib/utils";

interface SegmentedOption<T extends string> {
  label: React.ReactNode;
  value: T;
}

interface SegmentedProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: SegmentedOption<T>[];
  size?: "sm" | "md";
  className?: string;
  "aria-label"?: string;
}

/** Lightweight single-select pill group (used for Expense/Income + table filters). */
function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  size = "md",
  className,
  "aria-label": ariaLabel,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted p-0.5",
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onValueChange(opt.value)}
            className={cn(
              "rounded-md font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
              size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-sm",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export { Segmented };
