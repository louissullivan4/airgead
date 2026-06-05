"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  api,
  amountOf,
  isIncome,
  type CreateExpenseData,
  type Expense,
  type ReceiptLineItemInput,
  type ReceiptParsed,
} from "@/lib/api";
import { CURRENCIES } from "@/lib/categories";
import { OCR_AUTOFILL_ENABLED } from "@/lib/constants";
import { categoryOptions, firstLeafSlug, type CategoryOption } from "@/lib/org";
import { useOrgCategories } from "@/lib/use-org-categories";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FileUpload } from "@/components/ui/file-upload";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Segmented } from "@/components/ui/segmented";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

interface TransactionFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expense?: Expense | null;
  defaultCurrency?: string;
  onSaved: () => void;
  /** Set when the form was opened from a captured receipt (Phase 2 multi-line). */
  receiptId?: string | null;
  /** Signed URL of the cleaned receipt image, shown as a thumbnail. */
  receiptImageUrl?: string | null;
  /**
   * Parsed OCR data for the dormant auto-fill path. Only used when
   * OCR_AUTOFILL_ENABLED is true; null on the live flow today.
   */
  parsed?: ReceiptParsed | null;
}

// Reusable category picker for both the legacy form and per-line-item selects.
function CategorySelect({
  id,
  value,
  onValueChange,
  options,
}: {
  id?: string;
  value: string;
  onValueChange: (v: string) => void;
  options: CategoryOption[];
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger id={id}>
        <SelectValue placeholder="Select a category" />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) =>
          opt.kind === "group" ? (
            <SelectGroup key={opt.label}>
              <SelectLabel>{opt.label}</SelectLabel>
              {opt.items.map((it) => (
                <SelectItem key={it.slug} value={it.slug} className="pl-10">
                  {it.label}
                </SelectItem>
              ))}
            </SelectGroup>
          ) : (
            <SelectItem key={opt.slug} value={opt.slug}>
              {opt.label}
            </SelectItem>
          ),
        )}
      </SelectContent>
    </Select>
  );
}

const LOW_CONFIDENCE = 0.7;

// Dormant auto-fill affordance: a low-confidence warning on an editable field.
// Renders nothing unless the OCR flag is on AND the field's confidence is low.
function ConfidenceHint({ enabled, score }: { enabled: boolean; score?: number }) {
  if (!enabled || score === undefined || score >= LOW_CONFIDENCE) return null;
  return (
    <span className="mt-1 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
      <AlertTriangle className="size-3.5" />
      Low confidence — please check
    </span>
  );
}

interface LineDraft {
  key: number;
  title: string;
  category: string;
  amount: string;
  description: string;
}

function TransactionFormDialog({
  open,
  onOpenChange,
  expense,
  defaultCurrency = "EUR",
  onSaved,
  receiptId = null,
  receiptImageUrl = null,
  parsed = null,
}: TransactionFormDialogProps) {
  const editing = Boolean(expense);
  const receiptMode = Boolean(receiptId);
  const autofill = OCR_AUTOFILL_ENABLED && Boolean(parsed);
  const { tree } = useOrgCategories();
  const expenseOptions = categoryOptions(tree, "expense");

  // --- legacy single-item state (edit + skip-photo paths) ---
  const [type, setType] = useState<"expense" | "income">("expense");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [description, setDescription] = useState("");
  const [image, setImage] = useState<string | undefined>(undefined);

  // --- receipt multi-line state ---
  const [merchant, setMerchant] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([]);

  const [saving, setSaving] = useState(false);

  // Prefill (edit) or reset (add) whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    if (expense) {
      const income = isIncome(expense);
      setType(income ? "income" : "expense");
      setTitle(expense.title ?? "");
      setAmount(String(amountOf(expense)));
      setCurrency(expense.currency || defaultCurrency);
      setDescription(expense.description ?? "");
    } else {
      setType("expense");
      setTitle("");
      setAmount("");
      setCurrency(defaultCurrency);
      setDescription("");
    }
    setImage(undefined);
  }, [open, expense, defaultCurrency]);

  // Seed the expense category from the org's tree (separate effect so a late
  // category fetch doesn't wipe other in-progress fields).
  useEffect(() => {
    if (!open) return;
    setCategory(
      expense && !isIncome(expense) ? expense.category : firstLeafSlug(tree, "expense"),
    );
  }, [open, expense, tree]);

  // Receipt mode: seed merchant/currency and the line items. With the OCR flag
  // off (the default), this just produces one blank line for manual entry. With
  // it on AND parsed data present, it pre-fills from the parsed receipt.
  useEffect(() => {
    if (!open || !receiptMode) return;
    const leaf = firstLeafSlug(tree, "expense");
    if (autofill && parsed) {
      setMerchant(parsed.merchant ?? "");
      setCurrency(parsed.currency || defaultCurrency);
      const items = parsed.lineItems?.length
        ? parsed.lineItems
        : [{ description: "", amount: parsed.total ?? 0 }];
      setLines(
        items.map((it, i) => ({
          key: i,
          title: it.description ?? "",
          category: it.category || leaf,
          amount: it.amount ? String(it.amount) : "",
          description: "",
        })),
      );
    } else {
      setMerchant("");
      setCurrency(defaultCurrency);
      setLines([{ key: 0, title: "", category: leaf, amount: "", description: "" }]);
    }
  }, [open, receiptMode, autofill, parsed, tree, defaultCurrency]);

  const updateLine = (key: number, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const addLine = () =>
    setLines((prev) => [
      ...prev,
      {
        key: (prev.at(-1)?.key ?? 0) + 1,
        title: "",
        category: firstLeafSlug(tree, "expense"),
        amount: "",
        description: "",
      },
    ]);

  const removeLine = (key: number) =>
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));

  async function saveReceiptLines() {
    const items: ReceiptLineItemInput[] = [];
    for (const l of lines) {
      const numeric = Number(l.amount);
      if (!numeric || !l.category) {
        toast.error("Each line needs a category and a non-zero amount.");
        return;
      }
      items.push({
        title: l.title.trim() || undefined,
        description: l.description.trim() || undefined,
        category: l.category,
        amount: numeric,
        currency,
        merchant_name: merchant.trim() || undefined,
      });
    }
    setSaving(true);
    try {
      await api.receipts.createExpenses(receiptId as string, items);
      toast.success(items.length > 1 ? `${items.length} items added` : "Transaction added");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save transaction");
    } finally {
      setSaving(false);
    }
  }

  async function saveSingle() {
    const numeric = Number(amount);
    if (!title.trim() || !numeric) {
      toast.error("Add a title and a non-zero amount.");
      return;
    }
    const payload: CreateExpenseData = {
      title: title.trim(),
      description: description || undefined,
      category: type === "income" ? "income" : category,
      amount: numeric,
      currency,
      image,
    };
    setSaving(true);
    try {
      if (expense) {
        await api.expenses.update(expense.id, payload);
        toast.success("Transaction updated");
      } else {
        await api.expenses.create(payload);
        toast.success("Transaction added");
      }
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save transaction");
    } finally {
      setSaving(false);
    }
  }

  const fc = parsed?.fieldConfidence;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {receiptMode ? "Receipt details" : editing ? "Edit transaction" : "Add transaction"}
          </DialogTitle>
        </DialogHeader>

        {receiptMode ? (
          <div className="space-y-4">
            {receiptImageUrl && (
              <a
                href={receiptImageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-lg border border-border p-2"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={receiptImageUrl}
                  alt="Cleaned receipt"
                  className="size-12 rounded-md border border-border object-cover"
                />
                <span className="text-sm text-muted-foreground">Receipt attached — tap to view</span>
              </a>
            )}

            <div className="grid grid-cols-[1fr_7rem] gap-3">
              <Field label="Merchant" htmlFor="tx-merchant" hint="Optional">
                <Input
                  id="tx-merchant"
                  value={merchant}
                  onChange={(e) => setMerchant(e.target.value)}
                  placeholder="e.g. The Corner Cafe"
                />
                <ConfidenceHint enabled={autofill} score={fc?.merchant} />
              </Field>
              <Field label="Currency" htmlFor="tx-currency">
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger id="tx-currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <ConfidenceHint enabled={autofill} score={fc?.currency} />
              </Field>
            </div>

            <div className="space-y-3">
              {lines.map((l, i) => (
                <div key={l.key} className="space-y-3 rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">
                      Line item {i + 1}
                    </span>
                    {lines.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => removeLine(l.key)}
                        aria-label={`Remove line item ${i + 1}`}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                  <Field label="Title" htmlFor={`line-title-${l.key}`} hint="Optional">
                    <Input
                      id={`line-title-${l.key}`}
                      value={l.title}
                      onChange={(e) => updateLine(l.key, { title: e.target.value })}
                      placeholder="e.g. Lunch"
                    />
                  </Field>
                  <div className="grid grid-cols-[1fr_8rem] gap-3">
                    <Field label="Category" htmlFor={`line-cat-${l.key}`}>
                      <CategorySelect
                        id={`line-cat-${l.key}`}
                        value={l.category}
                        onValueChange={(v) => updateLine(l.key, { category: v })}
                        options={expenseOptions}
                      />
                    </Field>
                    <Field label="Amount" htmlFor={`line-amt-${l.key}`} required>
                      <Input
                        id={`line-amt-${l.key}`}
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        value={l.amount}
                        onChange={(e) => updateLine(l.key, { amount: e.target.value })}
                        placeholder="0.00"
                      />
                    </Field>
                  </div>
                </div>
              ))}
            </div>

            <Button type="button" variant="outline" size="sm" onClick={addLine}>
              <Plus />
              Add line item
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <Segmented
              value={type}
              onValueChange={setType}
              aria-label="Transaction type"
              options={[
                { label: "Expense", value: "expense" },
                { label: "Income", value: "income" },
              ]}
            />

            <Field label="Title" htmlFor="tx-title" required>
              <Input
                id="tx-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={type === "income" ? "e.g. Client payment" : "e.g. Train ticket"}
              />
            </Field>

            {type === "expense" && (
              <Field label="Category" htmlFor="tx-category">
                <CategorySelect
                  id="tx-category"
                  value={category}
                  onValueChange={setCategory}
                  options={expenseOptions}
                />
              </Field>
            )}

            <div className="grid grid-cols-[1fr_7rem] gap-3">
              <Field label="Amount" htmlFor="tx-amount" required>
                <Input
                  id="tx-amount"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                />
              </Field>
              <Field label="Currency" htmlFor="tx-currency">
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger id="tx-currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field label="Description" htmlFor="tx-desc" hint="Optional">
              <Textarea
                id="tx-desc"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>

            <Field label="Receipt">
              <FileUpload value={image} onChange={setImage} />
            </Field>
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={receiptMode ? saveReceiptLines : saveSingle} disabled={saving}>
            {saving && <Spinner />}
            {saving ? "Saving…" : editing ? "Save changes" : "Add transaction"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { TransactionFormDialog };
