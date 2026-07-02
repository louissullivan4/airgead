"use client";

import { useEffect, useState } from "react";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, type CategoryNode, type CategoryTree } from "@/lib/api";
import { slugify } from "@/lib/org";
import { invalidateOrgCategories } from "@/lib/use-org-categories";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

type Side = "expense" | "income";

// Editor node: existing nodes keep their stable slug; new nodes get one at save
// time (slug "") so historical expenses.category values keep resolving on rename.
interface EditNode {
  slug: string;
  label: string;
  children?: EditNode[];
}

interface EditTree {
  expense: EditNode[];
  income: EditNode[];
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// Reserve all existing slugs, then assign fresh unique slugs to new nodes
// (those with an empty slug), so a new slug never collides with an existing one.
function finalize(tree: EditTree): CategoryTree {
  const used = new Set<string>();
  const seed = (nodes: EditNode[]) =>
    nodes.forEach((n) => {
      if (n.slug) used.add(n.slug);
      if (n.children) seed(n.children);
    });
  seed(tree.expense);
  seed(tree.income);

  const uniq = (base: string) => {
    const root = base || "category";
    let s = root;
    let n = 2;
    while (used.has(s)) s = `${root}_${n++}`;
    used.add(s);
    return s;
  };

  const fin = (node: EditNode): CategoryNode | null => {
    const label = node.label.trim();
    if (!label) return null;
    const slug = node.slug || uniq(slugify(label));
    const children = (node.children ?? [])
      .map(fin)
      .filter((c): c is CategoryNode => c !== null);
    return children.length ? { slug, label, children } : { slug, label };
  };

  const finSide = (nodes: EditNode[]) =>
    nodes.map(fin).filter((c): c is CategoryNode => c !== null);

  return { expense: finSide(tree.expense), income: finSide(tree.income) };
}

export function OrgCategoriesEditor({
  orgId,
  canEdit,
}: {
  orgId: string;
  canEdit: boolean;
}) {
  const [tree, setTree] = useState<EditTree | null>(null);
  const [defaults, setDefaults] = useState<CategoryTree | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    api.organisations
      .getCategories(orgId)
      .then((res) => {
        if (!active) return;
        setTree(clone(res.categories) as EditTree);
        setDefaults(res.defaults);
      })
      .catch((err) => active && toast.error(err instanceof Error ? err.message : "Failed to load categories"))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [orgId]);

  // All mutations clone the tree so React sees a new reference.
  function mutate(fn: (draft: EditTree) => void) {
    setTree((prev) => {
      if (!prev) return prev;
      const draft = clone(prev);
      fn(draft);
      return draft;
    });
  }

  const addCategory = (side: Side) =>
    mutate((d) => d[side].push({ slug: "", label: "" }));
  const deleteCategory = (side: Side, i: number) =>
    mutate((d) => d[side].splice(i, 1));
  const setCategoryLabel = (side: Side, i: number, label: string) =>
    mutate((d) => {
      d[side][i].label = label;
    });
  const addSub = (side: Side, i: number) =>
    mutate((d) => {
      (d[side][i].children ??= []).push({ slug: "", label: "" });
    });
  const deleteSub = (side: Side, i: number, j: number) =>
    mutate((d) => d[side][i].children!.splice(j, 1));
  const setSubLabel = (side: Side, i: number, j: number, label: string) =>
    mutate((d) => {
      d[side][i].children![j].label = label;
    });

  function resetToDefaults() {
    if (defaults) setTree(clone(defaults) as EditTree);
  }

  async function save() {
    if (!tree) return;
    setSaving(true);
    try {
      await api.organisations.update(orgId, { categories: finalize(tree) });
      invalidateOrgCategories(orgId);
      toast.success("Categories saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save categories");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Skeleton className="h-64 rounded-xl" />;
  if (!tree) return null;

  const renderSide = (side: Side, title: string) => (
    <div className="space-y-3">
      <h4 className="text-sm font-medium">{title}</h4>
      {tree[side].map((cat, i) => (
        <div key={i} className="space-y-2 rounded-md border border-border p-3">
          <div className="flex items-center gap-2">
            <Input
              value={cat.label}
              disabled={!canEdit}
              onChange={(e) => setCategoryLabel(side, i, e.target.value)}
              placeholder="Category name"
            />
            {canEdit && (
              <Button
                type="button"
                vaairgeadt="ghost"
                size="icon-sm"
                onClick={() => deleteCategory(side, i)}
                aria-label="Delete category"
              >
                <Trash2 />
              </Button>
            )}
          </div>
          <div className="space-y-2 pl-4">
            {(cat.children ?? []).map((sub, j) => (
              <div key={j} className="flex items-center gap-2">
                <Input
                  value={sub.label}
                  disabled={!canEdit}
                  onChange={(e) => setSubLabel(side, i, j, e.target.value)}
                  placeholder="Subcategory"
                />
                {canEdit && (
                  <Button
                    type="button"
                    vaairgeadt="ghost"
                    size="icon-sm"
                    onClick={() => deleteSub(side, i, j)}
                    aria-label="Delete subcategory"
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
            ))}
            {canEdit && (
              <Button type="button" vaairgeadt="link" size="sm" className="px-0" onClick={() => addSub(side, i)}>
                <Plus /> Add subcategory
              </Button>
            )}
          </div>
        </div>
      ))}
      {canEdit && (
        <Button type="button" vaairgeadt="outline" size="sm" onClick={() => addCategory(side)}>
          <Plus /> Add category
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2">
        {renderSide("expense", "Expense categories")}
        {renderSide("income", "Income categories")}
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={save} disabled={saving}>
            {saving && <Spinner />}
            {saving ? "Saving…" : "Save categories"}
          </Button>
          <Button type="button" vaairgeadt="outline" onClick={resetToDefaults} disabled={saving}>
            <RotateCcw /> Reset to defaults
          </Button>
        </div>
      )}
    </div>
  );
}
