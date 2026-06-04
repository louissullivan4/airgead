"use client";

import { useEffect, useState } from "react";
import {
  Modal,
  TextInput,
  TextArea,
  Select,
  SelectItem,
  NumberInput,
  ContentSwitcher,
  Switch,
  FileUploader,
  InlineNotification,
} from "@carbon/react";
import {
  api,
  isIncome,
  type Expense,
  type CreateExpenseData,
} from "@/lib/api";

const EXPENSE_CATEGORIES = [
  "office",
  "travel",
  "meals",
  "utilities",
  "software",
  "equipment",
  "professional",
  "other",
];

const CURRENCIES = ["EUR", "GBP", "USD"];

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function TransactionFormModal({
  open,
  onClose,
  onSaved,
  expense,
  defaultCurrency = "EUR",
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** When set, the modal edits this transaction; otherwise it creates one. */
  expense?: Expense | null;
  defaultCurrency?: string;
}) {
  const editing = Boolean(expense);

  const [type, setType] = useState<"expense" | "income">("expense");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [description, setDescription] = useState("");
  const [image, setImage] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset/prefill whenever the modal opens or the target changes.
  useEffect(() => {
    if (!open) return;
    if (expense) {
      const income = isIncome(expense);
      setType(income ? "income" : "expense");
      setTitle(expense.title ?? "");
      setCategory(income ? "income" : expense.category || EXPENSE_CATEGORIES[0]);
      setAmount(String(expense.amount ?? ""));
      setCurrency(expense.currency || defaultCurrency);
      setDescription(expense.description ?? "");
    } else {
      setType("expense");
      setTitle("");
      setCategory(EXPENSE_CATEGORIES[0]);
      setAmount("");
      setCurrency(defaultCurrency);
      setDescription("");
    }
    setImage(undefined);
    setError(null);
  }, [open, expense, defaultCurrency]);

  async function handleFile(file?: File) {
    if (!file) return setImage(undefined);
    try {
      setImage(await readFileAsDataUrl(file));
    } catch {
      setError("Could not read the selected image.");
    }
  }

  async function handleSubmit() {
    setError(null);
    const numericAmount = Number(amount);
    if (!title || !numericAmount) {
      setError("Title and a non-zero amount are required.");
      return;
    }
    const payload: CreateExpenseData = {
      title,
      description: description || undefined,
      category: type === "income" ? "income" : category,
      amount: numericAmount,
      currency,
      image,
    };
    setSaving(true);
    try {
      if (expense) {
        await api.expenses.update(expense.id, payload);
      } else {
        await api.expenses.create(payload);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save transaction");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      modalHeading={editing ? "Edit transaction" : "Add transaction"}
      primaryButtonText={saving ? "Saving…" : "Save"}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={saving}
      onRequestClose={onClose}
      onSecondarySubmit={onClose}
      onRequestSubmit={handleSubmit}
    >
      {error && (
        <InlineNotification kind="error" title="Error" subtitle={error} lowContrast />
      )}

      <ContentSwitcher
        selectedIndex={type === "expense" ? 0 : 1}
        onChange={({ index }) => setType(index === 0 ? "expense" : "income")}
        style={{ marginBottom: "1rem", maxWidth: "20rem" }}
      >
        <Switch name="expense" text="Expense" />
        <Switch name="income" text="Income" />
      </ContentSwitcher>

      <TextInput
        id="tx-title"
        labelText="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        style={{ marginBottom: "1rem" }}
      />

      {type === "expense" && (
        <Select
          id="tx-category"
          labelText="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          style={{ marginBottom: "1rem" }}
        >
          {EXPENSE_CATEGORIES.map((c) => (
            <SelectItem key={c} value={c} text={c[0].toUpperCase() + c.slice(1)} />
          ))}
        </Select>
      )}

      <div className="form-grid" style={{ marginBottom: "1rem" }}>
        <NumberInput
          id="tx-amount"
          label="Amount"
          value={amount === "" ? undefined : Number(amount)}
          step={0.01}
          min={0}
          onChange={(_e, { value }) => setAmount(value === "" ? "" : String(value))}
          hideSteppers
        />
        <Select
          id="tx-currency"
          labelText="Currency"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
        >
          {CURRENCIES.map((c) => (
            <SelectItem key={c} value={c} text={c} />
          ))}
        </Select>
      </div>

      <TextArea
        id="tx-description"
        labelText="Description (optional)"
        rows={2}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        style={{ marginBottom: "1rem" }}
      />

      <FileUploader
        labelTitle="Receipt"
        labelDescription="Attach a receipt image (optional)."
        buttonLabel="Add file"
        accept={["image/*"]}
        filenameStatus="edit"
        onChange={(e) => handleFile((e.target as HTMLInputElement).files?.[0])}
        onDelete={() => setImage(undefined)}
      />
    </Modal>
  );
}
