"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, type Asset, type AssetType } from "@/lib/api";
import { ASSET_TYPE_OPTIONS } from "@/lib/org";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

/** Local YYYY-MM-DD (mirrors transaction-form-dialog's toDateInput). */
function toDateInput(value?: string | null): string {
  const d = value ? new Date(value) : new Date();
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 10);
}

interface AssetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing target; null/undefined = create a standalone (opening) asset. */
  asset?: Asset | null;
  onSaved: () => void;
}

/**
 * Add or edit an asset-register entry. Editing an asset that came from an
 * expense keeps the expense untouched — only the register row changes. The
 * disposal fields stop wear & tear from the disposal year.
 */
function AssetDialog({ open, onOpenChange, asset, onSaved }: AssetDialogProps) {
  const editing = Boolean(asset);

  const [description, setDescription] = useState("");
  const [assetType, setAssetType] = useState<AssetType>("plant_machinery");
  const [cost, setCost] = useState("");
  const [acquiredDate, setAcquiredDate] = useState(() => toDateInput());
  const [disposed, setDisposed] = useState(false);
  const [disposalDate, setDisposalDate] = useState(() => toDateInput());
  const [disposalProceeds, setDisposalProceeds] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (asset) {
      setDescription(asset.description);
      setAssetType(asset.asset_type);
      setCost(String(Number(asset.cost) || ""));
      setAcquiredDate(toDateInput(asset.acquired_date));
      setDisposed(Boolean(asset.disposal_date));
      setDisposalDate(toDateInput(asset.disposal_date));
      setDisposalProceeds(
        asset.disposal_proceeds != null ? String(Number(asset.disposal_proceeds)) : "",
      );
    } else {
      setDescription("");
      setAssetType("plant_machinery");
      setCost("");
      setAcquiredDate(toDateInput());
      setDisposed(false);
      setDisposalDate(toDateInput());
      setDisposalProceeds("");
    }
  }, [open, asset]);

  async function handleSave() {
    const numericCost = Number(cost);
    if (!description.trim() || !numericCost || numericCost <= 0) {
      toast.error("Add a description and a positive cost.");
      return;
    }
    setSaving(true);
    try {
      if (editing && asset) {
        await api.assets.update(asset.id, {
          description: description.trim(),
          asset_type: assetType,
          cost: numericCost,
          acquired_date: acquiredDate,
          disposal_date: disposed ? disposalDate : null,
          disposal_proceeds: disposed && disposalProceeds ? Number(disposalProceeds) : null,
        });
        toast.success("Asset updated");
      } else {
        await api.assets.create({
          description: description.trim(),
          asset_type: assetType,
          cost: numericCost,
          acquired_date: acquiredDate,
        });
        toast.success("Asset added to the register");
      }
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save asset");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit asset" : "Add asset"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Update the register entry — allowances recompute automatically."
              : "An opening asset (bought before you started capturing here). Day-to-day purchases are better captured as transactions marked “Capital item”."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="Description" htmlFor="asset-desc" required>
            <Input
              id="asset-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. John Deere 6120M tractor"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Type" htmlFor="asset-type">
              <Select value={assetType} onValueChange={(v) => setAssetType(v as AssetType)}>
                <SelectTrigger id="asset-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSET_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Cost" htmlFor="asset-cost" required>
              <Input
                id="asset-cost"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder="0.00"
              />
            </Field>
          </div>

          <Field
            label="Acquired"
            htmlFor="asset-acquired"
            hint="Wear & tear starts in this year (12.5% × 8 years)."
          >
            <Input
              id="asset-acquired"
              type="date"
              value={acquiredDate}
              onChange={(e) => setAcquiredDate(e.target.value)}
            />
          </Field>

          {editing && (
            <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
              <label htmlFor="asset-disposed" className="flex cursor-pointer items-center gap-2.5 text-sm font-medium">
                <input
                  id="asset-disposed"
                  type="checkbox"
                  checked={disposed}
                  onChange={(e) => setDisposed(e.target.checked)}
                  className="size-4 cursor-pointer accent-primary"
                />
                Sold or disposed of
              </label>
              {disposed && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Disposal date" htmlFor="asset-disposal-date">
                    <Input
                      id="asset-disposal-date"
                      type="date"
                      value={disposalDate}
                      onChange={(e) => setDisposalDate(e.target.value)}
                    />
                  </Field>
                  <Field label="Proceeds" htmlFor="asset-proceeds" hint="Optional">
                    <Input
                      id="asset-proceeds"
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      value={disposalProceeds}
                      onChange={(e) => setDisposalProceeds(e.target.value)}
                      placeholder="0.00"
                    />
                  </Field>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Spinner />}
            {saving ? "Saving…" : editing ? "Save changes" : "Add asset"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { AssetDialog };
