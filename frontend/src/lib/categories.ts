// Single source of truth for transaction categories: the canonical list, the
// currencies we support, and the visual language (icon + accent classes) used
// by badges, the category breakdown bars, and transaction rows.
//
// Income is modelled as a category (`category === "income"`) — see lib/api.ts.

import {
  Banknote,
  Briefcase,
  Building2,
  Code2,
  Plane,
  Tag,
  UtensilsCrossed,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

/** Expense categories offered in the add/edit form (mirrors the backend enum). */
export const EXPENSE_CATEGORIES = [
  "office",
  "travel",
  "meals",
  "utilities",
  "software",
  "equipment",
  "professional",
  "other",
] as const;

/** Currencies offered across signup, settings, and the transaction form. */
export const CURRENCIES = ["EUR", "GBP", "USD"] as const;

export interface CategoryMeta {
  key: string;
  label: string;
  Icon: LucideIcon;
  /** Tag chip classes (bg + text + ring), light & dark. Written as full literals so Tailwind detects them. */
  badge: string;
  /** Solid color for breakdown bars / status dots. */
  dot: string;
}

const META: Record<string, CategoryMeta> = {
  office: {
    key: "office",
    label: "Office",
    Icon: Building2,
    badge:
      "bg-indigo-50 text-indigo-700 ring-indigo-600/10 dark:bg-indigo-950 dark:text-indigo-300 dark:ring-indigo-400/20",
    dot: "bg-indigo-500",
  },
  travel: {
    key: "travel",
    label: "Travel",
    Icon: Plane,
    badge:
      "bg-sky-50 text-sky-700 ring-sky-600/10 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-400/20",
    dot: "bg-sky-500",
  },
  meals: {
    key: "meals",
    label: "Meals",
    Icon: UtensilsCrossed,
    badge:
      "bg-amber-50 text-amber-700 ring-amber-600/10 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-400/20",
    dot: "bg-amber-500",
  },
  utilities: {
    key: "utilities",
    label: "Utilities",
    Icon: Zap,
    badge:
      "bg-cyan-50 text-cyan-700 ring-cyan-600/10 dark:bg-cyan-950 dark:text-cyan-300 dark:ring-cyan-400/20",
    dot: "bg-cyan-500",
  },
  software: {
    key: "software",
    label: "Software",
    Icon: Code2,
    badge:
      "bg-violet-50 text-violet-700 ring-violet-600/10 dark:bg-violet-950 dark:text-violet-300 dark:ring-violet-400/20",
    dot: "bg-violet-500",
  },
  equipment: {
    key: "equipment",
    label: "Equipment",
    Icon: Wrench,
    badge:
      "bg-orange-50 text-orange-700 ring-orange-600/10 dark:bg-orange-950 dark:text-orange-300 dark:ring-orange-400/20",
    dot: "bg-orange-500",
  },
  professional: {
    key: "professional",
    label: "Professional",
    Icon: Briefcase,
    badge:
      "bg-emerald-50 text-emerald-700 ring-emerald-600/10 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-400/20",
    dot: "bg-emerald-500",
  },
  other: {
    key: "other",
    label: "Other",
    Icon: Tag,
    badge:
      "bg-zinc-100 text-zinc-700 ring-zinc-600/10 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-400/20",
    dot: "bg-zinc-400",
  },
  income: {
    key: "income",
    label: "Income",
    Icon: Banknote,
    badge:
      "bg-green-50 text-green-700 ring-green-600/10 dark:bg-green-950 dark:text-green-300 dark:ring-green-400/20",
    dot: "bg-green-500",
  },
};

const FALLBACK: CategoryMeta = META.other;

/** Look up category metadata, falling back to a titize-cased "Other"-style chip. */
export function categoryMeta(key: string): CategoryMeta {
  const found = META[key];
  if (found) return found;
  return {
    ...FALLBACK,
    key,
    label: key ? key[0].toUpperCase() + key.slice(1) : "Uncategorized",
  };
}
