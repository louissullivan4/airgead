"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ClickableTile,
  SkeletonText,
  SkeletonPlaceholder,
  InlineNotification,
  Button,
} from "@carbon/react";
import { DonutChart } from "@carbon/charts-react";
import {
  api,
  amountOf,
  isIncome,
  formatCurrency,
  type Expense,
  type UserProfile,
} from "@/lib/api";
import { useSession } from "@/lib/session";

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
    let receiptCount = 0;
    const categoryMap = new Map<string, number>();

    for (const e of expenses) {
      const amount = amountOf(e);
      if (isIncome(e)) {
        income += amount;
      } else {
        expensesTotal += amount;
        categoryMap.set(e.category, (categoryMap.get(e.category) ?? 0) + amount);
      }
      if (e.receipt_image_url) receiptCount += 1;
    }

    const byCategory = Array.from(categoryMap, ([group, value]) => ({ group, value }));
    const recent = [...expenses]
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
      .slice(0, 5);

    return {
      income,
      expensesTotal,
      net: income - expensesTotal,
      receiptCount,
      byCategory,
      recent,
    };
  }, [expenses]);

  if (loading || sessionLoading) {
    return (
      <div>
        <h1 className="page-title">Home</h1>
        <SkeletonPlaceholder style={{ width: "100%", height: "8rem", marginBottom: "1.5rem" }} />
        <SkeletonText paragraph lineCount={4} />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h1 className="page-title">Home</h1>
        <InlineNotification kind="error" title="Could not load your data" subtitle={error} lowContrast />
      </div>
    );
  }

  const tiles = [
    { label: `${TAX_YEAR} expenses`, value: formatCurrency(expensesTotal, currency) },
    { label: `${TAX_YEAR} income`, value: formatCurrency(income, currency) },
    { label: "Net", value: formatCurrency(net, currency) },
    { label: "Receipts", value: String(receiptCount) },
  ];

  return (
    <div>
      <h1 className="page-title">Home</h1>

      <div className="tile-grid">
        {tiles.map((t) => (
          <ClickableTile key={t.label} href="/transactions">
            <div className="stat-tile__label">{t.label}</div>
            <div className="stat-tile__value">{t.value}</div>
          </ClickableTile>
        ))}
      </div>

      <section className="section">
        <h2>Spending by category</h2>
        {byCategory.length === 0 ? (
          <p>No expenses recorded for {TAX_YEAR} yet.</p>
        ) : (
          <DonutChart
            data={byCategory}
            options={{
              resizable: true,
              height: "320px",
              donut: { center: { label: "Expenses" } },
            }}
          />
        )}
      </section>

      <section className="section">
        <h2>Recent activity</h2>
        {recent.length === 0 ? (
          <p>No transactions yet.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {recent.map((e) => (
              <li
                key={e.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "0.75rem 0",
                  borderBottom: "1px solid var(--cds-border-subtle)",
                }}
              >
                <Link href="/transactions" style={{ textDecoration: "none" }}>
                  {e.title || e.category}
                  <span style={{ color: "var(--cds-text-secondary)", marginLeft: "0.5rem" }}>
                    {new Date(e.created_at).toLocaleDateString()}
                  </span>
                </Link>
                <span style={{ color: isIncome(e) ? "var(--cds-support-success)" : undefined }}>
                  {isIncome(e) ? "+" : "−"}
                  {formatCurrency(amountOf(e), currency)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Button kind="ghost" href="/transactions" as={Link} style={{ marginTop: "0.5rem" }}>
          View all transactions
        </Button>
      </section>
    </div>
  );
}
