"use client";

import { useEffect, useState } from "react";
import { api, type CategoryTree } from "@/lib/api";
import { useSession } from "@/lib/session";
import { DEFAULT_CATEGORY_TREE } from "@/lib/org";

interface UseOrgCategories {
  tree: CategoryTree;
  loading: boolean;
}

// Per-org cache so the transaction dialog (re)opens instantly and we don't refetch
// the tree on every render. Keyed by org id.
const cache = new Map<string, CategoryTree>();

/**
 * The current org's category tree, for the transaction form. Falls back to
 * DEFAULT_CATEGORY_TREE when there's no session or the fetch fails, so the form
 * always has usable categories.
 */
export function useOrgCategories(): UseOrgCategories {
  const { session, loading: sessionLoading } = useSession();
  const orgId = session?.orgId;
  const [tree, setTree] = useState<CategoryTree>(
    () => (orgId && cache.get(orgId)) || DEFAULT_CATEGORY_TREE,
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (sessionLoading) return;
    if (!orgId) {
      setTree(DEFAULT_CATEGORY_TREE);
      setLoading(false);
      return;
    }
    const cached = cache.get(orgId);
    if (cached) {
      setTree(cached);
      setLoading(false);
      return;
    }
    let active = true;
    api.organisations
      .getCategories(orgId)
      .then((res) => {
        cache.set(orgId, res.categories);
        if (active) setTree(res.categories);
      })
      .catch(() => active && setTree(DEFAULT_CATEGORY_TREE))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [orgId, sessionLoading]);

  return { tree, loading };
}

/** Invalidate the cached tree for an org after it's been edited in settings. */
export function invalidateOrgCategories(orgId: string) {
  cache.delete(orgId);
}
