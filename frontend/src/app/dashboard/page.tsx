"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type Expense, type User } from "@/lib/api";
import { BRAND } from "@/lib/brand";

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      router.push("/login");
      return;
    }

    async function load() {
      try {
        // TODO: decode user id from JWT or store user object at login
        const userId = "TODO";
        const [fetchedExpenses] = await Promise.all([
          api.expenses.getByUserId(userId),
        ]);
        setExpenses(fetchedExpenses);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [router]);

  function handleLogout() {
    localStorage.removeItem("token");
    router.push("/login");
  }

  const totalIncome = expenses
    .filter((e) => e.is_income)
    .reduce((sum, e) => sum + e.amount, 0);

  const totalExpenses = expenses
    .filter((e) => !e.is_income)
    .reduce((sum, e) => sum + e.amount, 0);

  if (loading) return <p>Loading…</p>;
  if (error) return <p role="alert">{error}</p>;

  return (
    <main>
      <nav>
        <span>{BRAND}</span>
        <a href="/expenses">Expenses</a>
        <button onClick={handleLogout}>Sign out</button>
      </nav>

      <h1>Dashboard{user ? ` — ${user.name}` : ""}</h1>

      <section>
        <h2>Summary</h2>
        <dl>
          <dt>Income</dt>
          <dd>${totalIncome.toFixed(2)}</dd>
          <dt>Expenses</dt>
          <dd>${totalExpenses.toFixed(2)}</dd>
          <dt>Net</dt>
          <dd>${(totalIncome - totalExpenses).toFixed(2)}</dd>
        </dl>
      </section>

      <section>
        <h2>Recent transactions</h2>
        {expenses.length === 0 ? (
          <p>No transactions yet.</p>
        ) : (
          <ul>
            {expenses.slice(0, 5).map((e) => (
              <li key={e.id}>
                {e.date} — {e.category} — ${e.amount.toFixed(2)}
                {e.is_income ? " (income)" : ""}
              </li>
            ))}
          </ul>
        )}
        <a href="/expenses">View all</a>
      </section>
    </main>
  );
}
