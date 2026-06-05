import { categoryMeta } from "@/lib/categories";
import { cn } from "@/lib/utils";

/** Pill chip with category color + icon + label. */
function CategoryBadge({
  category,
  className,
  showIcon = true,
}: {
  category: string;
  className?: string;
  showIcon?: boolean;
}) {
  const meta = categoryMeta(category);
  const Icon = meta.Icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        meta.badge,
        className,
      )}
    >
      {showIcon && <Icon className="size-3" />}
      {meta.label}
    </span>
  );
}

/** Round category glyph used as a leading element in transaction rows. */
function CategoryIcon({ category, className }: { category: string; className?: string }) {
  const meta = categoryMeta(category);
  const Icon = meta.Icon;
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full ring-1 ring-inset",
        meta.badge,
        className,
      )}
    >
      <Icon className="size-4" />
    </span>
  );
}

export { CategoryBadge, CategoryIcon };
