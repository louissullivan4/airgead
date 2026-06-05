import { formatCurrency } from "@/lib/api";
import { categoryMeta } from "@/lib/categories";
import { cn } from "@/lib/utils";

export interface CategoryDatum {
  category: string;
  value: number;
}

interface CategoryBreakdownProps {
  data: CategoryDatum[];
  currency: string;
  className?: string;
}

/** Dependency-free spending visualization: sorted category bars with share %. */
function CategoryBreakdown({ data, currency, className }: CategoryBreakdownProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const sorted = [...data].sort((a, b) => b.value - a.value);
  const max = sorted[0]?.value ?? 0;

  return (
    <div className={cn("space-y-3.5", className)}>
      {sorted.map((d) => {
        const meta = categoryMeta(d.category);
        const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
        const width = max > 0 ? (d.value / max) * 100 : 0;
        return (
          <div key={d.category} className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <span className={cn("size-2.5 shrink-0 rounded-full", meta.dot)} />
                <span className="truncate font-medium">{meta.label}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2 tabular-nums">
                <span className="text-muted-foreground">{pct}%</span>
                <span className="font-medium">{formatCurrency(d.value, currency)}</span>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full transition-[width] duration-500", meta.dot)}
                style={{ width: `${width}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export { CategoryBreakdown };
