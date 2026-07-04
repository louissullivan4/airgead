"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  api,
  ApiError,
  type SageClientSettings,
  type SageExportResult,
  type SageOption,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Phase = "loading" | "unlinked" | "form" | "exporting" | "done";

interface SageExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: { id: string; name: string } | null;
  year: number;
}

const displayName = (options: SageOption[], id: string) =>
  options.find((o) => o.id === id)?.displayed_as;

/**
 * "Export to Sage" dialog: pick the target Sage business, bank account and
 * ledger accounts (remembered per client), then push the year's transactions.
 * Expenses become Sage Other Payments; income becomes Other Receipts; rows
 * already exported to the same business are skipped server-side.
 */
function SageExportDialog({ open, onOpenChange, client, year }: SageExportDialogProps) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SageExportResult | null>(null);

  const [businesses, setBusinesses] = useState<SageOption[]>([]);
  const [bankAccounts, setBankAccounts] = useState<SageOption[]>([]);
  const [ledgerAccounts, setLedgerAccounts] = useState<SageOption[]>([]);
  const [taxRates, setTaxRates] = useState<SageOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);

  const [businessId, setBusinessId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [expenseLedgerId, setExpenseLedgerId] = useState("");
  const [incomeLedgerId, setIncomeLedgerId] = useState("");
  const [taxRateId, setTaxRateId] = useState("");
  const [remembered, setRemembered] = useState<SageClientSettings["settings"]>(null);

  // Fresh open: load the remembered mapping and the business list together.
  useEffect(() => {
    if (!open || !client) return;
    let active = true;
    setPhase("loading");
    setError(null);
    setResult(null);
    Promise.all([api.accountant.getSageExportSettings(client.id), api.sage.businesses()])
      .then(([saved, bizList]) => {
        if (!active) return;
        if (!saved.connected) {
          setPhase("unlinked");
          return;
        }
        setBusinesses(bizList);
        setRemembered(saved.settings);
        if (saved.settings && bizList.some((b) => b.id === saved.settings?.sage_business_id)) {
          setBusinessId(saved.settings.sage_business_id);
        }
        setPhase("form");
      })
      .catch((err) => {
        if (!active) return;
        if (err instanceof ApiError && (err.code === "sage_not_connected" || err.code === "sage_reconnect_required")) {
          setPhase("unlinked");
        } else {
          setError(err instanceof Error ? err.message : "Could not reach Sage.");
          setPhase("form");
        }
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, client?.id]);

  // Business chosen: load its accounts, prefilling remembered ids that still exist.
  const loadBusinessOptions = useCallback(
    (bizId: string) => {
      setOptionsLoading(true);
      setBankAccountId("");
      setExpenseLedgerId("");
      setIncomeLedgerId("");
      setTaxRateId("");
      Promise.all([
        api.sage.bankAccounts(bizId),
        api.sage.ledgerAccounts(bizId),
        api.sage.taxRates(bizId),
      ])
        .then(([banks, ledgers, rates]) => {
          setBankAccounts(banks);
          setLedgerAccounts(ledgers);
          setTaxRates(rates);
          if (remembered && remembered.sage_business_id === bizId) {
            if (banks.some((b) => b.id === remembered.bank_account_id))
              setBankAccountId(remembered.bank_account_id);
            if (ledgers.some((l) => l.id === remembered.expense_ledger_account_id))
              setExpenseLedgerId(remembered.expense_ledger_account_id);
            if (ledgers.some((l) => l.id === remembered.income_ledger_account_id))
              setIncomeLedgerId(remembered.income_ledger_account_id);
            if (remembered.tax_rate_id && rates.some((r) => r.id === remembered.tax_rate_id))
              setTaxRateId(remembered.tax_rate_id);
          }
        })
        .catch((err) => setError(err instanceof Error ? err.message : "Could not reach Sage."))
        .finally(() => setOptionsLoading(false));
    },
    [remembered],
  );

  useEffect(() => {
    if (businessId && phase === "form") loadBusinessOptions(businessId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  const ready = businessId && bankAccountId && expenseLedgerId && incomeLedgerId;

  async function runExport() {
    if (!client || !ready) return;
    setPhase("exporting");
    setError(null);
    try {
      const summary = await api.accountant.exportClientToSage(client.id, {
        year,
        businessId,
        businessName: displayName(businesses, businessId),
        bankAccountId,
        bankAccountName: displayName(bankAccounts, bankAccountId),
        expenseLedgerAccountId: expenseLedgerId,
        expenseLedgerAccountName: displayName(ledgerAccounts, expenseLedgerId),
        incomeLedgerAccountId: incomeLedgerId,
        incomeLedgerAccountName: displayName(ledgerAccounts, incomeLedgerId),
        ...(taxRateId ? { taxRateId } : {}),
      });
      setResult(summary);
      setPhase("done");
      if (summary.failed === 0) toast.success(`Exported ${client.name} to Sage.`);
    } catch (err) {
      if (err instanceof ApiError && err.code === "sage_reconnect_required") {
        setPhase("unlinked");
        return;
      }
      setError(err instanceof Error ? err.message : "Export failed.");
      setPhase("form");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && phase !== "exporting" && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Export to Sage</DialogTitle>
          <DialogDescription>
            Push {client?.name ?? "this client"}&apos;s {year} transactions into Sage. Already-exported
            rows are skipped automatically.
          </DialogDescription>
        </DialogHeader>

        {phase === "loading" && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Spinner /> Checking your Sage connection…
          </div>
        )}

        {phase === "unlinked" && (
          <div className="space-y-3 py-4 text-sm text-muted-foreground">
            <p>Your practice&apos;s Sage account isn&apos;t linked (or the link has expired).</p>
            <p>
              <Link href="/settings" className="font-medium text-primary hover:underline">
                Link your Sage account in Settings
              </Link>{" "}
              and come back here to export.
            </p>
          </div>
        )}

        {phase === "form" && (
          <div className="space-y-4">
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Field label="Sage business" htmlFor="sage-business">
              <Select value={businessId} onValueChange={setBusinessId}>
                <SelectTrigger id="sage-business">
                  <SelectValue placeholder="Select a business" />
                </SelectTrigger>
                <SelectContent>
                  {businesses.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.displayed_as}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {businessId && (
              <>
                <Field label="Bank account" htmlFor="sage-bank">
                  <Select value={bankAccountId} onValueChange={setBankAccountId} disabled={optionsLoading}>
                    <SelectTrigger id="sage-bank">
                      <SelectValue placeholder={optionsLoading ? "Loading…" : "Select a bank account"} />
                    </SelectTrigger>
                    <SelectContent>
                      {bankAccounts.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.displayed_as}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Expense ledger account" htmlFor="sage-expense-ledger">
                  <Select value={expenseLedgerId} onValueChange={setExpenseLedgerId} disabled={optionsLoading}>
                    <SelectTrigger id="sage-expense-ledger">
                      <SelectValue placeholder={optionsLoading ? "Loading…" : "Where expenses post"} />
                    </SelectTrigger>
                    <SelectContent>
                      {ledgerAccounts.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.displayed_as}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Income ledger account" htmlFor="sage-income-ledger">
                  <Select value={incomeLedgerId} onValueChange={setIncomeLedgerId} disabled={optionsLoading}>
                    <SelectTrigger id="sage-income-ledger">
                      <SelectValue placeholder={optionsLoading ? "Loading…" : "Where income posts"} />
                    </SelectTrigger>
                    <SelectContent>
                      {ledgerAccounts.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.displayed_as}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Tax rate (optional, applied to every line)" htmlFor="sage-tax-rate">
                  <Select value={taxRateId} onValueChange={setTaxRateId} disabled={optionsLoading}>
                    <SelectTrigger id="sage-tax-rate">
                      <SelectValue placeholder={optionsLoading ? "Loading…" : "No tax rate"} />
                    </SelectTrigger>
                    <SelectContent>
                      {taxRates.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.displayed_as}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </>
            )}
          </div>
        )}

        {phase === "exporting" && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Spinner /> Exporting - this can take a minute for large years…
          </div>
        )}

        {phase === "done" && result && (
          <div className="space-y-3 py-2 text-sm">
            <p>
              <span className="font-medium">{result.created}</span> created,{" "}
              <span className="font-medium">{result.skipped}</span> already in Sage (skipped)
              {result.failed > 0 && (
                <>
                  , <span className="font-medium text-destructive">{result.failed}</span> failed
                </>
              )}
              .
            </p>
            {result.failed > 0 && (
              <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2 text-xs text-muted-foreground">
                {result.failures.map((f) => (
                  <li key={f.expenseId}>
                    <span className="font-medium text-foreground">{f.title}</span> - {f.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <DialogFooter>
          {phase === "form" && (
            <>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button onClick={runExport} disabled={!ready || optionsLoading}>
                Export to Sage
              </Button>
            </>
          )}
          {(phase === "done" || phase === "unlinked") && (
            <DialogClose asChild>
              <Button variant="outline">Close</Button>
            </DialogClose>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { SageExportDialog };
