"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DataTable,
  Table,
  TableHead,
  TableRow,
  TableHeader,
  TableBody,
  TableCell,
  TableContainer,
  TableToolbar,
  TableToolbarContent,
  TableToolbarSearch,
  Pagination,
  OverflowMenu,
  OverflowMenuItem,
  Button,
  Dropdown,
  DataTableSkeleton,
  InlineNotification,
  Modal,
} from "@carbon/react";
import { Add, Download } from "@carbon/icons-react";
import {
  api,
  amountOf,
  isIncome,
  formatCurrency,
  type Expense,
  type UserProfile,
} from "@/lib/api";
import { useSession } from "@/lib/session";
import TransactionFormModal from "@/components/TransactionFormModal";
import ReceiptThumb from "@/components/ReceiptThumb";

const TYPE_FILTERS = ["All", "Expenses", "Income"] as const;
type TypeFilter = (typeof TYPE_FILTERS)[number];

const TAX_YEAR = new Date().getFullYear();

const HEADERS = [
  { key: "title", header: "Title" },
  { key: "category", header: "Category" },
  { key: "date", header: "Date" },
  { key: "amount", header: "Amount" },
  { key: "receipt", header: "Receipt" },
  { key: "actions", header: "" },
];

export default function TransactionsPage() {
  const { session, loading: sessionLoading } = useSession();
  const [all, setAll] = useState<Expense[]>([]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [typeFilter, setTypeFilter] = useState<TypeFilter>("All");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const currency = profile?.currency ?? "EUR";

  const load = useCallback(async (userId: string) => {
    setLoading(true);
    try {
      const data = await api.expenses.getByUserId(userId);
      data.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
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

  // Phase 2 swaps this for a camera-first capture flow — keep the trigger isolated.
  const onAddTransaction = () => {
    setEditing(null);
    setAddOpen(true);
  };

  const filtered = useMemo(() => {
    if (typeFilter === "Income") return all.filter(isIncome);
    if (typeFilter === "Expenses") return all.filter((e) => !isIncome(e));
    return all;
  }, [all, typeFilter]);

  const lookup = useMemo(() => new Map(filtered.map((e) => [e.id, e])), [filtered]);

  const rows = useMemo(
    () =>
      filtered.map((e) => ({
        id: e.id,
        title: e.title || "(untitled)",
        category: e.category,
        date: e.created_at,
        amount: amountOf(e),
        receipt: e.receipt_image_url ? "1" : "",
        actions: "",
      })),
    [filtered],
  );

  async function handleExport() {
    if (!session) return;
    setExporting(true);
    setNotice(null);
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
      setNotice(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await api.expenses.delete(deleting.id);
      setDeleting(null);
      if (session) void load(session.userId);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Delete failed");
    }
  }

  if (loading || sessionLoading) {
    return (
      <div>
        <h1 className="page-title">Transactions</h1>
        <DataTableSkeleton columnCount={5} rowCount={8} showHeader={false} />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h1 className="page-title">Transactions</h1>
        <InlineNotification kind="error" title="Could not load transactions" subtitle={error} lowContrast />
      </div>
    );
  }

  return (
    <div>
      <h1 className="page-title">Transactions</h1>

      {notice && (
        <InlineNotification
          kind="error"
          title="Error"
          subtitle={notice}
          lowContrast
          onCloseButtonClick={() => setNotice(null)}
        />
      )}

      <DataTable rows={rows} headers={HEADERS} isSortable>
        {({ rows: dtRows, headers, getHeaderProps, getRowProps, getTableProps, onInputChange }) => {
          const start = (page - 1) * pageSize;
          const visible = dtRows.slice(start, start + pageSize);
          return (
            <TableContainer>
              <TableToolbar>
                <TableToolbarContent>
                  <TableToolbarSearch
                    persistent
                    placeholder="Search transactions"
                    onChange={(e) => {
                      setPage(1);
                      onInputChange(e as React.ChangeEvent<HTMLInputElement>);
                    }}
                  />
                  <Dropdown
                    id="type-filter"
                    size="lg"
                    type="inline"
                    label="Type"
                    titleText=""
                    items={[...TYPE_FILTERS]}
                    selectedItem={typeFilter}
                    onChange={({ selectedItem }) => {
                      setTypeFilter((selectedItem as TypeFilter) ?? "All");
                      setPage(1);
                    }}
                    style={{ minWidth: "10rem" }}
                  />
                  <Button
                    kind="ghost"
                    renderIcon={Download}
                    onClick={handleExport}
                    disabled={exporting}
                  >
                    {exporting ? "Exporting…" : "Export"}
                  </Button>
                  <Button renderIcon={Add} onClick={onAddTransaction}>
                    Add
                  </Button>
                </TableToolbarContent>
              </TableToolbar>
              <Table {...getTableProps()}>
                <TableHead>
                  <TableRow>
                    {headers.map((header) => {
                      const { key, ...headerProps } = getHeaderProps({ header });
                      return (
                        <TableHeader key={header.key} {...headerProps}>
                          {header.header}
                        </TableHeader>
                      );
                    })}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {visible.map((row) => {
                    const expense = lookup.get(row.id);
                    const { key, ...rowProps } = getRowProps({ row });
                    return (
                      <TableRow key={row.id} {...rowProps}>
                        {row.cells.map((cell) => {
                          const header = cell.info.header;
                          if (header === "amount" && expense) {
                            return (
                              <TableCell key={cell.id}>
                                {isIncome(expense) ? "+" : "−"}
                                {formatCurrency(Number(cell.value), currency)}
                              </TableCell>
                            );
                          }
                          if (header === "date") {
                            return (
                              <TableCell key={cell.id}>
                                {new Date(cell.value).toLocaleDateString()}
                              </TableCell>
                            );
                          }
                          if (header === "receipt") {
                            return (
                              <TableCell key={cell.id}>
                                <ReceiptThumb expenseId={row.id} hasReceipt={cell.value === "1"} />
                              </TableCell>
                            );
                          }
                          if (header === "actions") {
                            return (
                              <TableCell key={cell.id}>
                                <OverflowMenu aria-label="Row actions" flipped size="sm">
                                  <OverflowMenuItem
                                    itemText="Edit"
                                    onClick={() => {
                                      if (expense) {
                                        setEditing(expense);
                                        setAddOpen(true);
                                      }
                                    }}
                                  />
                                  <OverflowMenuItem
                                    isDelete
                                    itemText="Delete"
                                    onClick={() => expense && setDeleting(expense)}
                                  />
                                </OverflowMenu>
                              </TableCell>
                            );
                          }
                          return <TableCell key={cell.id}>{cell.value}</TableCell>;
                        })}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {dtRows.length === 0 && (
                <p style={{ padding: "1.5rem" }}>
                  No transactions{typeFilter !== "All" ? ` of type "${typeFilter}"` : ""} yet.
                </p>
              )}
              <Pagination
                totalItems={dtRows.length}
                page={page}
                pageSize={pageSize}
                pageSizes={[10, 25, 50]}
                onChange={({ page: p, pageSize: ps }) => {
                  setPage(p);
                  setPageSize(ps);
                }}
              />
            </TableContainer>
          );
        }}
      </DataTable>

      <TransactionFormModal
        open={addOpen}
        expense={editing}
        defaultCurrency={currency}
        onClose={() => {
          setAddOpen(false);
          setEditing(null);
        }}
        onSaved={() => session && load(session.userId)}
      />

      <Modal
        open={Boolean(deleting)}
        danger
        modalHeading="Delete transaction"
        primaryButtonText="Delete"
        secondaryButtonText="Cancel"
        onRequestClose={() => setDeleting(null)}
        onSecondarySubmit={() => setDeleting(null)}
        onRequestSubmit={confirmDelete}
      >
        <p>
          Delete &ldquo;{deleting?.title || deleting?.category}&rdquo;? This cannot be undone.
        </p>
      </Modal>
    </div>
  );
}
