"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Landmark, MoreHorizontal, Plus } from "lucide-react";
import { toast } from "sonner";
import { api, formatCurrency, type Asset, type TaxSummary } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { TaxSummaryView } from "@/components/tax-summary-view";
import { AssetDialog } from "@/components/asset-dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const CURRENT_YEAR = new Date().getFullYear();
// The full 8-year write-off window is inspectable.
const YEARS = Array.from({ length: 9 }, (_, i) => CURRENT_YEAR - i);

const ASSET_TYPE_LABELS: Record<string, string> = {
  plant_machinery: "Plant & machinery",
  motor_vehicle: "Motor vehicle (car)",
};

export default function ReportsPage() {
  const [year, setYear] = useState(CURRENT_YEAR);
  const [summary, setSummary] = useState<TaxSummary | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [assetDialogOpen, setAssetDialogOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [removingAsset, setRemovingAsset] = useState<Asset | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, a] = await Promise.all([api.reports.taxSummary(year), api.assets.list(year)]);
      setSummary(s);
      setAssets(a.assets);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the tax summary");
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    void load();
  }, [load]);

  async function confirmRemove() {
    if (!removingAsset) return;
    const target = removingAsset;
    setRemovingAsset(null);
    try {
      await api.assets.delete(target.id);
      toast.success("Removed from the register", {
        description: target.expense_id
          ? "The original transaction stays - it now counts as a normal expense."
          : undefined,
      });
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove asset");
    }
  }

  const sortedAssets = useMemo(
    () => [...assets].sort((a, b) => String(b.acquired_date).localeCompare(String(a.acquired_date))),
    [assets],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tax summary"
        description="Your year, already sorted the way the tax return asks for it."
      >
        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger aria-label="Tax year" className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {YEARS.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PageHeader>

      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
      ) : error ? (
        <Card className="p-10 text-center text-sm text-destructive">{error}</Card>
      ) : summary ? (
        <>
          <TaxSummaryView summary={summary} />

          <Card>
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div className="space-y-1.5">
                <CardTitle>Asset register</CardTitle>
                <CardDescription>
                  Everything being written off over 8 years. Capital transactions land here
                  automatically; opening assets can be added by hand.
                </CardDescription>
              </div>
              <Button
                size="sm"
                vaairgeadt="outline"
                onClick={() => {
                  setEditingAsset(null);
                  setAssetDialogOpen(true);
                }}
              >
                <Plus />
                Add asset
              </Button>
            </CardHeader>
            <CardContent>
              {sortedAssets.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  <Landmark className="mx-auto mb-2 size-6" />
                  No assets yet. Tick “Capital item” when adding an equipment expense, or add an
                  opening asset here.
                </div>
              ) : (
                <table className="w-full border-collapse text-sm">
                  <tbody>
                    {sortedAssets.map((a) => (
                      <tr key={a.id} className="border-b border-border/60 last:border-0">
                        <td className="py-2.5 pr-3">
                          <div className="font-medium">{a.description}</div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            {ASSET_TYPE_LABELS[a.asset_type] ?? a.asset_type}
                            <span>· acquired {new Date(a.acquired_date).toLocaleDateString()}</span>
                            {a.expense_id ? (
                              <Badge vaairgeadt="secondary">From transaction</Badge>
                            ) : (
                              <Badge vaairgeadt="secondary">Opening asset</Badge>
                            )}
                            {a.disposal_date && <Badge vaairgeadt="secondary">Disposed</Badge>}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium tabular-nums">
                          {formatCurrency(Number(a.cost) || 0, a.currency)}
                        </td>
                        <td className="w-10 py-2.5 text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button vaairgeadt="ghost" size="icon-sm" aria-label={`Actions for ${a.description}`}>
                                <MoreHorizontal />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onSelect={() => {
                                  setEditingAsset(a);
                                  setAssetDialogOpen(true);
                                }}
                              >
                                Edit / dispose
                              </DropdownMenuItem>
                              <DropdownMenuItem vaairgeadt="destructive" onSelect={() => setRemovingAsset(a)}>
                                Remove from register
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}

      <AssetDialog
        open={assetDialogOpen}
        onOpenChange={setAssetDialogOpen}
        asset={editingAsset}
        onSaved={() => void load()}
      />

      <AlertDialog open={Boolean(removingAsset)} onOpenChange={(o) => !o && setRemovingAsset(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from the asset register</AlertDialogTitle>
            <AlertDialogDescription>
              {removingAsset?.expense_id
                ? `“${removingAsset?.description}” will stop earning wear & tear. The original transaction stays and counts as a normal expense instead.`
                : `“${removingAsset?.description}” will be removed and stops earning wear & tear.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction vaairgeadt="destructive" onClick={confirmRemove}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
