// Organisation-level constants and helpers used at signup (pre-auth, so these
// must be available client-side without an API call) and in settings.
//
// ORG_CATEGORIES MUST stay in sync with ORG_CATEGORY_SLUGS in
// backend/src/config/categoryTemplates.js and the CHECK constraint in
// migrations/005_org_profile_fields.sql.

import type { CategoryNode, CategoryTree } from "@/lib/api";

export interface OrgCategoryOption {
  slug: string;
  label: string;
}

/** Friendly business-type options for the signup/settings selects. */
export const ORG_CATEGORIES: OrgCategoryOption[] = [
  { slug: "personal", label: "Personal" },
  { slug: "sole_trader_equine", label: "Sole trader — Equine / Equestrian" },
  { slug: "sole_trader_agriculture", label: "Sole trader — Agriculture / Farming" },
  { slug: "consultant", label: "Consultant / Professional services" },
  { slug: "retail", label: "Retail / Shop" },
  { slug: "trades_construction", label: "Trades & Construction" },
  { slug: "hospitality", label: "Hospitality / Food & Drink" },
  { slug: "other", label: "Other business" },
];

export const DEFAULT_ORG_CATEGORY = "personal";

export interface Country {
  code: string;
  label: string;
}

export const COUNTRIES: Country[] = [
  { code: "IE", label: "Ireland" },
  { code: "GB", label: "United Kingdom" },
  { code: "US", label: "United States" },
  { code: "FR", label: "France" },
  { code: "DE", label: "Germany" },
  { code: "ES", label: "Spain" },
];

export const DEFAULT_COUNTRY = "IE";

// Offline / failed-fetch fallback for the transaction form — mirrors the backend
// DEFAULT_TEMPLATE so the form always has a usable set of categories.
export const DEFAULT_CATEGORY_TREE: CategoryTree = {
  expense: [
    { slug: "office", label: "Office" },
    { slug: "travel", label: "Travel" },
    { slug: "meals", label: "Meals" },
    { slug: "utilities", label: "Utilities" },
    { slug: "software", label: "Software" },
    { slug: "equipment", label: "Equipment" },
    { slug: "professional", label: "Professional" },
    { slug: "other", label: "Other" },
  ],
  income: [
    { slug: "sales", label: "Sales" },
    { slug: "other_income", label: "Other income" },
  ],
};

// A flattened, render-ready view of one side of the tree for the <Select>:
//   - "item":  a standalone selectable category (no children)
//   - "group": a header label with its selectable child options indented under it
export type CategoryOption =
  | { kind: "item"; slug: string; label: string }
  | { kind: "group"; label: string; items: { slug: string; label: string }[] };

export function categoryOptions(
  tree: CategoryTree | undefined,
  side: "expense" | "income",
): CategoryOption[] {
  const nodes: CategoryNode[] = tree?.[side] ?? [];
  return nodes.map((node) =>
    node.children && node.children.length > 0
      ? {
          kind: "group" as const,
          label: node.label,
          items: node.children.map((c) => ({ slug: c.slug, label: c.label })),
        }
      : { kind: "item" as const, slug: node.slug, label: node.label },
  );
}

/** First selectable leaf slug in a side of the tree (used as a sensible default). */
export function firstLeafSlug(
  tree: CategoryTree | undefined,
  side: "expense" | "income",
): string {
  const nodes: CategoryNode[] = tree?.[side] ?? [];
  for (const node of nodes) {
    if (node.children && node.children.length > 0) return node.children[0].slug;
    return node.slug;
  }
  return "other";
}

/** Slugify a label for a newly-created category (existing slugs are preserved on rename). */
export function slugify(label: string): string {
  return (
    label
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "category"
  );
}
