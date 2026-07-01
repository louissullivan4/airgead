"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Download, Receipt, Search } from "lucide-react";
import { toast } from "sonner";
import { api, amountOf, isIncome, type Expense, type TaxSummary } from "@/lib/api";
import { TransactionsTable, type SortKey } from "@/components/transactions-table";
import { TransactionList } from "@/components/transaction-list";
import { TaxSummaryView } from "@/components/tax-summary-view";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";

const TYPE_FILTERS = ["All", "Expenses", "Income"] as const;
type TypeFilter = (typeof TYPE_FILTERS)[number];
const VIEWS = ["Transactions", "Tax summary"] as const;
type View = (typeof VIEWS)[number];
const TAX_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 9 }, (_, i) => TAX_YEAR - i);

export default function ClientDetailPage() {
  const params = useParams<{ clientOrgId: string }>();
  const clientOrgId = params.clientOrgId;

  const [all, setAll] = useState<Expense[]>([]);
  const [clientName, setClientName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // The client's tax picture (Form 11 / capital allowances / VAT), per year.
  const [view, setView] = useState<View>("Transactions");
  const [taxYear, setTaxYear] = useState(TAX_YEAR);
  const [taxSummary, setTaxSummary] = useState<TaxSummary | null>(null);
  const [taxLoading, setTaxLoading] = useState(false);
  const [taxError, setTaxError] = useState<string | null>(null);

  const [typeFilter, setTypeFilter] = useState<TypeFilter>("All");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // listClients both resolves the display name and re-confirms access.
      const [txns, clients] = await Promise.all([
        api.accountant.getClientTransactions(clientOrgId),
        api.accountant.listClients().catch(() => []),
      ]);
      setAll(txns);
      // Resolve the display name from the client list, falling back to the org
      // record (a super admin may open an org that isn't a linked client).
      let name = clients.find((c) => c.id === clientOrgId)?.name;
      if (!name) {
        name = await api.organisations.get(clientOrgId).then((o) => o.name).catch(() => "Organisation");
      }
      setClientName(name);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load client transactions");
    } finally {
      setLoading(false);
    }
  }, [clientOrgId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Fetch the tax summary lazily — only once the tab is opened (or year changes).
  useEffect(() => {
    if (view !== "Tax summary") return;
    let active = true;
    setTaxLoading(true);
    api.accountant
      .getClientTaxSummary(clientOrgId, taxYear)
      .then((s) => {
        if (!active) return;
        setTaxSummary(s);
        setTaxError(null);
      })
      .catch((err) => active && setTaxError(err instanceof Error ? err.message : "Failed to load tax summary"))
      .finally(() => active && setTaxLoading(false));
    return () => {
      active = false;
    };
  }, [view, clientOrgId, taxYear]);

  // Client books may be multi-currency; show the most common one in the column.
  const currency = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of all) counts.set(e.currency, (counts.get(e.currency) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "EUR";
  }, [all]);

  const onSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "date" ? "desc" : "asc");
    }
  };

  const filtered = useMemo(() => {
    let list = all;
    if (typeFilter === "Income") list = list.filter(isIncome);
    else if (typeFilter === "Expenses") list = list.filter((e) => !isIncome(e));

    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (e) =>
          (e.title ?? "").toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q) ||
          (e.description ?? "").toLowerCase().includes(q),
      );
    }

    return [...list].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "title") cmp = (a.title || "").localeCompare(b.title || "");
      else if (sortKey === "category") cmp = a.category.localeCompare(b.category);
      else if (sortKey === "amount") cmp = amountOf(a) - amountOf(b);
      else cmp = +new Date(a.created_at) - +new Date(b.created_at);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [all, typeFilter, search, sortKey, sortDir]);

  const total = filtered.length;
  const visible = useMemo(
    () => filtered.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize),
    [filtered, page, pageSize],
  );

  useEffect(() => {
    setPage(1);
  }, [typeFilter, search, pageSize]);

  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    if (page > pageCount) setPage(pageCount);
  }, [total, pageSize, page]);

  async function handleExport() {
    setExporting(true);
    try {
      const blob = await api.accountant.exportClient(clientOrgId, TAX_YEAR, "zip");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(clientName || "client").replace(/[^a-z0-9]+/gi, "_")}_${TAX_YEAR}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  const filtering = Boolean(search) || typeFilter !== "All";

  return (
    <div className="space-y-5">
      {/* "Viewing someone else's data" context bar — unmistakable, not loud. */}
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 px-4 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <span className="text-muted-foreground">Viewing </span>
          <span className="font-medium">{clientName || "client"}</span>
          <span className="ml-2 inline-flex items-center rounded-full bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground ring-1 ring-inset ring-border">
            read-only
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
            {exporting ? <Spinner /> : <Download />}
            {exporting ? "Exporting…" : "Export"}
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/clients">
              <ArrowLeft />
              Back to clients
            </Link>
          </Button>
        </div>
      </div>

      <Segmented
        value={view}
        onValueChange={setView}
        aria-label="Client view"
        options={VIEWS.map((v) => ({ label: v, value: v }))}
      />

      {view === "Tax summary" ? (
        <div className="space-y-4">
          <div className="flex items-center justify-end">
            <Select value={String(taxYear)} onValueChange={(v) => setTaxYear(Number(v))}>
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
          </div>
          {taxLoading ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-28 rounded-xl" />
                ))}
              </div>
              <Skeleton className="h-64 rounded-xl" />
            </div>
          ) : taxError ? (
            <Card className="p-10 text-center text-sm text-destructive">{taxError}</Card>
          ) : taxSummary ? (
            <TaxSummaryView summary={taxSummary} />
          ) : null}
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search transactions"
                className="pl-9"
              />
            </div>
            <Segmented
              value={typeFilter}
              onValueChange={setTypeFilter}
              aria-label="Filter by type"
              options={TYPE_FILTERS.map((t) => ({ label: t, value: t }))}
            />
          </div>

          {loading ? (
            <Card className="space-y-3 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 rounded-lg" />
              ))}
            </Card>
          ) : error ? (
            <Card className="p-10 text-center text-sm text-destructive">{error}</Card>
          ) : total === 0 ? (
            <EmptyState
              icon={Receipt}
              title={filtering ? "No matching transactions" : "No transactions yet"}
              description={
                filtering ? "Try clearing your search or filter." : "This client hasn't recorded anything yet."
              }
            />
          ) : (
            <Card className="overflow-hidden">
              <div className="hidden lg:block">
                <TransactionsTable
                  expenses={visible}
                  currency={currency}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSort}
                  readOnly
                />
              </div>
              <div className="px-2 lg:hidden">
                <TransactionList expenses={visible} currency={currency} />
              </div>
              <Pagination
                page={page}
                pageSize={pageSize}
                total={total}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
              />
            </Card>
          )}
        </>
      )}
    </div>
  );
}
