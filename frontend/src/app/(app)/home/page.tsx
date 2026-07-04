"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Plus, Receipt, Scale } from "lucide-react";
import {
  api,
  amountOf,
  formatCurrency,
  isIncome,
  type Expense,
  type UserProfile,
} from "@/lib/api";
import { useSession } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { StatCard, StatGrid } from "@/components/stat-card";
import { CategoryBreakdown } from "@/components/category-breakdown";
import { TransactionList } from "@/components/transaction-list";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

const TAX_YEAR = new Date().getFullYear();

export default function HomePage() {
  const { session, loading: sessionLoading } = useSession();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (sessionLoading) return;
    if (!session) {
      setLoading(false);
      return;
    }
    let active = true;
    (async () => {
      try {
        const [fetchedExpenses, fetchedProfile] = await Promise.all([
          api.expenses.getByUserIdAndYear(session.userId, TAX_YEAR),
          api.users.getById(session.userId).catch(() => null),
        ]);
        if (!active) return;
        setExpenses(fetchedExpenses);
        setProfile(fetchedProfile);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [session, sessionLoading]);

  const currency = profile?.currency ?? "EUR";

  const { income, expensesTotal, net, receiptCount, byCategory, recent } = useMemo(() => {
    let income = 0;
    let expensesTotal = 0;
    // Camera captures store the image on a shared receipts row (receipt_id,
    // possibly across several line items), legacy uploads on the expense
    // itself (receipt_image_url) - count distinct receipts across both.
    let legacyReceiptCount = 0;
    const receiptIds = new Set<string>();
    const categoryMap = new Map<string, number>();

    for (const e of expenses) {
      const amount = amountOf(e);
      if (isIncome(e)) {
        income += amount;
      } else {
        expensesTotal += amount;
        categoryMap.set(e.category, (categoryMap.get(e.category) ?? 0) + amount);
      }
      if (e.receipt_id) {
        receiptIds.add(e.receipt_id);
      } else if (e.receipt_image_url) {
        legacyReceiptCount += 1;
      }
    }
    const receiptCount = receiptIds.size + legacyReceiptCount;

    const byCategory = Array.from(categoryMap, ([category, value]) => ({ category, value }));
    const recent = [...expenses]
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
      .slice(0, 6);

    return { income, expensesTotal, net: income - expensesTotal, receiptCount, byCategory, recent };
  }, [expenses]);

  if (loading || sessionLoading) {
    return (
      <div className="space-y-8">
        <PageHeader title={`${TAX_YEAR} overview`} />
        <StatGrid>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </StatGrid>
        <div className="grid gap-6 lg:grid-cols-5">
          <Skeleton className="h-64 rounded-xl lg:col-span-2" />
          <Skeleton className="h-64 rounded-xl lg:col-span-3" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title={`${TAX_YEAR} overview`} />
        <Card>
          <CardContent className="py-10 text-center text-sm text-destructive">{error}</CardContent>
        </Card>
      </div>
    );
  }

  const addButton = (
    <Button asChild>
      <Link href="/transactions?add=1">
        <Plus />
        Add transaction
      </Link>
    </Button>
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title={`${TAX_YEAR} overview`}
        description="Your income, expenses, and receipts at a glance."
      >
        {addButton}
      </PageHeader>

      <StatGrid>
        <StatCard
          label="Expenses"
          value={formatCurrency(expensesTotal, currency)}
          icon={ArrowUpRight}
          emphasis
          href="/transactions"
        />
        <StatCard
          label="Income"
          value={formatCurrency(income, currency)}
          icon={ArrowDownLeft}
          href="/transactions"
        />
        <StatCard
          label="Net"
          value={formatCurrency(net, currency)}
          icon={Scale}
          tone={net >= 0 ? "success" : "destructive"}
          href="/transactions"
        />
        <StatCard
          label="Receipts"
          value={String(receiptCount)}
          icon={Receipt}
          href="/transactions"
        />
      </StatGrid>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Spending by category</CardTitle>
          </CardHeader>
          <CardContent>
            {byCategory.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No expenses recorded for {TAX_YEAR} yet.
              </p>
            ) : (
              <CategoryBreakdown data={byCategory} currency={currency} />
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Recent activity</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/transactions">View all</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <EmptyState
                icon={Receipt}
                title="No transactions yet"
                description="Add your first expense or income and it will show up here."
                action={addButton}
              />
            ) : (
              <TransactionList expenses={recent} currency={currency} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
