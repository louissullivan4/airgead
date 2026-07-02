"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Download,
  MoreHorizontal,
  Pencil,
  Plus,
  Receipt,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  api,
  amountOf,
  isIncome,
  type Expense,
  type ReceiptProcessResult,
  type UserProfile,
} from "@/lib/api";
import { useSession } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { TransactionsTable, type SortKey } from "@/components/transactions-table";
import { TransactionList } from "@/components/transaction-list";
import { TransactionFormDialog } from "@/components/transaction-form-dialog";
import { ReceiptCaptureDialog } from "@/components/receipt-capture-dialog";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
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

const TYPE_FILTERS = ["All", "Expenses", "Income"] as const;
type TypeFilter = (typeof TYPE_FILTERS)[number];
const TAX_YEAR = new Date().getFullYear();

function TransactionsInner() {
  const searchParams = useSearchParams();
  const { session, loading: sessionLoading } = useSession();
  const [all, setAll] = useState<Expense[]>([]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [typeFilter, setTypeFilter] = useState<TypeFilter>("All");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const [exporting, setExporting] = useState(false);

  // Camera-first add flow: the capture step runs before the form opens.
  const [captureOpen, setCaptureOpen] = useState(false);
  const [pendingReceipt, setPendingReceipt] = useState<ReceiptProcessResult | null>(null);

  const currency = profile?.currency ?? "EUR";

  const load = useCallback(async (userId: string) => {
    setLoading(true);
    try {
      const data = await api.expenses.getByUserId(userId);
      setAll(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load transactions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sessionLoading) return;
    if (!session) {
      setLoading(false);
      return;
    }
    void load(session.userId);
    api.users.getById(session.userId).then(setProfile).catch(() => {});
  }, [session, sessionLoading, load]);

  // PWA shortcut / dashboard deep-link: /transactions?add=1 opens the add flow
  // (starting at the camera capture step).
  useEffect(() => {
    if (searchParams.get("add") === "1") {
      setEditing(null);
      setPendingReceipt(null);
      setCaptureOpen(true);
    }
  }, [searchParams]);

  // Add starts at the camera capture step; editing opens the form directly.
  const openAdd = () => {
    setEditing(null);
    setPendingReceipt(null);
    setCaptureOpen(true);
  };
  const openEdit = (e: Expense) => {
    setEditing(e);
    setPendingReceipt(null);
    setDialogOpen(true);
  };

  // Capture step resolved: skip -> blank manual form; captured -> form prefilled
  // with the cleaned receipt + (dormant) parsed data.
  const onSkipPhoto = () => {
    setCaptureOpen(false);
    setPendingReceipt(null);
    setEditing(null);
    setDialogOpen(true);
  };
  const onCaptured = (result: ReceiptProcessResult) => {
    setCaptureOpen(false);
    setEditing(null);
    setPendingReceipt(result);
    setDialogOpen(true);
  };

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

  // Reset to the first page whenever the result set changes shape.
  useEffect(() => {
    setPage(1);
  }, [typeFilter, search, pageSize]);

  // Clamp if the current page falls past the end (e.g. after a delete).
  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    if (page > pageCount) setPage(pageCount);
  }, [total, pageSize, page]);

  async function handleExport() {
    if (!session) return;
    setExporting(true);
    try {
      const blob = await api.expenses.downloadZip(session.userId, TAX_YEAR);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `transactions_${TAX_YEAR}.zip`;
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

  async function confirmDelete() {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    try {
      await api.expenses.delete(target.id);
      toast.success("Transaction deleted");
      if (session) void load(session.userId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  }

  const rowMenu = (e: Expense) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Row actions">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => openEdit(e)}>
          <Pencil />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(e)}>
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const filtering = Boolean(search) || typeFilter !== "All";

  return (
    <div className="space-y-6">
      <PageHeader title="Transactions" description="Every expense and income entry.">
        <Button variant="outline" onClick={handleExport} disabled={exporting}>
          {exporting ? <Spinner /> : <Download />}
          {exporting ? "Exporting…" : "Export"}
        </Button>
        <Button onClick={openAdd}>
          <Plus />
          Add
        </Button>
      </PageHeader>

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

      {loading || sessionLoading ? (
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
            filtering
              ? "Try clearing your search or filter."
              : "Add your first expense or income to get started."
          }
          action={
            filtering ? undefined : (
              <Button onClick={openAdd}>
                <Plus />
                Add transaction
              </Button>
            )
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
              onEdit={openEdit}
              onDelete={setDeleting}
            />
          </div>
          <div className="px-2 lg:hidden">
            <TransactionList
              expenses={visible}
              currency={currency}
              onSelect={openEdit}
              renderAction={rowMenu}
            />
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

      <ReceiptCaptureDialog
        open={captureOpen}
        onOpenChange={setCaptureOpen}
        onSkip={onSkipPhoto}
        onCaptured={onCaptured}
      />

      <TransactionFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        expense={editing}
        defaultCurrency={currency}
        receiptId={pendingReceipt?.receiptId ?? null}
        receiptImageUrl={pendingReceipt?.signedUrl ?? null}
        parsed={pendingReceipt?.parsedData ?? null}
        onSaved={() => session && load(session.userId)}
      />

      <AlertDialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete transaction</AlertDialogTitle>
            <AlertDialogDescription>
              Delete &ldquo;{deleting?.title || deleting?.category}&rdquo;? This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function TransactionsPage() {
  return (
    <Suspense fallback={<TransactionsFallback />}>
      <TransactionsInner />
    </Suspense>
  );
}

function TransactionsFallback() {
  return (
    <div className="space-y-6">
      <PageHeader title="Transactions" />
      <Skeleton className="h-96 rounded-xl" />
    </div>
  );
}
