"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  api,
  amountOf,
  isIncome,
  type CreateExpenseData,
  type Expense,
} from "@/lib/api";
import { CURRENCIES } from "@/lib/categories";
import { categoryOptions, firstLeafSlug } from "@/lib/org";
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
}

function TransactionFormDialog({
  open,
  onOpenChange,
  expense,
  defaultCurrency = "EUR",
  onSaved,
}: TransactionFormDialogProps) {
  const editing = Boolean(expense);
  const { tree } = useOrgCategories();
  const expenseOptions = categoryOptions(tree, "expense");
  const [type, setType] = useState<"expense" | "income">("expense");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [description, setDescription] = useState("");
  const [image, setImage] = useState<string | undefined>(undefined);
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
  // category fetch doesn't wipe other in-progress fields). Income uses the
  // 'income' sentinel and has no category picker.
  useEffect(() => {
    if (!open) return;
    setCategory(
      expense && !isIncome(expense) ? expense.category : firstLeafSlug(tree, "expense"),
    );
  }, [open, expense, tree]);

  async function submit() {
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit transaction" : "Add transaction"}</DialogTitle>
        </DialogHeader>

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
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="tx-category">
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {expenseOptions.map((opt) =>
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

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={submit} disabled={saving}>
            {saving && <Spinner />}
            {saving ? "Saving…" : editing ? "Save changes" : "Add transaction"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { TransactionFormDialog };
