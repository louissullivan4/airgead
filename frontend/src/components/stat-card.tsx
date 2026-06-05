import * as React from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string;
  icon?: LucideIcon;
  hint?: string;
  href?: string;
  emphasis?: boolean;
  tone?: "default" | "success" | "destructive";
}

function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  href,
  emphasis = false,
  tone = "default",
}: StatCardProps) {
  const inner = (
    <div
      className={cn(
        "flex h-full flex-col justify-between gap-4 rounded-xl border border-border bg-card p-4 shadow-sm transition-colors sm:p-5",
        href && "hover:border-primary/30 hover:bg-accent/40",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        {Icon && <Icon className="size-4 text-muted-foreground" />}
      </div>
      <div>
        <div
          className={cn(
            "font-semibold tracking-tight tabular-nums",
            emphasis ? "text-2xl sm:text-3xl" : "text-xl sm:text-2xl",
            tone === "success" && "text-success",
            tone === "destructive" && "text-destructive",
          )}
        >
          {value}
        </div>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block h-full">
        {inner}
      </Link>
    );
  }
  return inner;
}

function StatGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)}>{children}</div>
  );
}

export { StatCard, StatGrid };
