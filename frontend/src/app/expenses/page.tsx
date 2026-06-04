"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type Expense } from "@/lib/api";

export default function ExpensesPage() {
  const router = useRouter();
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
        // TODO: replace with actual user id from auth context
        const userId = "TODO";
        setExpenses(await api.expenses.getByUserId(userId));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load expenses");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [router]);

  async function handleDelete(id: string) {
    if (!confirm("Delete this expense?")) return;
    try {
      await api.expenses.delete(id);
      setExpenses((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    }
  }

  if (loading) return <p>Loading…</p>;
  if (error) return <p role="alert">{error}</p>;

  return (
    <main>
      <nav>
        <a href="/dashboard">Dashboard</a>
        <span>Expenses</span>
      </nav>

      <h1>Expenses</h1>

      {expenses.length === 0 ? (
        <p>No expenses yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Category</th>
              <th>Description</th>
              <th>Amount</th>
              <th>Type</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((e) => (
              <tr key={e.id}>
                <td>{e.date}</td>
                <td>{e.category}</td>
                <td>{e.description}</td>
                <td>${e.amount.toFixed(2)}</td>
                <td>{e.is_income ? "Income" : "Expense"}</td>
                <td>
                  <button onClick={() => handleDelete(e.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
