import type { Expense } from "@/lib/api";
import { StatCard, StatGrid } from "@/components/stat-card";
import { CategoryBreakdown } from "@/components/category-breakdown";
import { TransactionList } from "@/components/transaction-list";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function sample(
  id: string,
  title: string,
  category: string,
  amount: string,
  date: string,
): Expense {
  return {
    id,
    user_id: "demo",
    title,
    description: null,
    category,
    amount,
    currency: "EUR",
    receipt_image_url: null,
    created_at: `${date}T10:00:00.000Z`,
    updated_at: `${date}T10:00:00.000Z`,
  };
}

const SAMPLE_TX: Expense[] = [
  sample("1", "Client payment", "income", "1200.00", "2026-05-02"),
  sample("2", "Flight to client", "travel", "320.00", "2026-05-09"),
  sample("3", "Design software", "software", "55.00", "2026-05-21"),
  sample("4", "Team lunch", "meals", "48.50", "2026-04-19"),
];

const SAMPLE_CATEGORIES = [
  { category: "travel", value: 320 },
  { category: "software", value: 180 },
  { category: "meals", value: 96 },
  { category: "office", value: 60 },
];

/** A realistic dashboard preview built from the real app components. */
function DashboardPreview() {
  return (
    <div className="rounded-2xl border border-border bg-card p-3 shadow-2xl shadow-primary/10 sm:p-4">
      <div className="space-y-4">
        <StatGrid>
          <StatCard label="Expenses" value="€1,066" emphasis />
          <StatCard label="Income" value="€1,200" />
          <StatCard label="Net" value="€134" tone="success" />
          <StatCard label="Receipts" value="18" />
        </StatGrid>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader className="p-4">
              <CardTitle className="text-sm">Spending by category</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <CategoryBreakdown data={SAMPLE_CATEGORIES} currency="EUR" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="p-4">
              <CardTitle className="text-sm">Recent activity</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <TransactionList expenses={SAMPLE_TX} currency="EUR" />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export { DashboardPreview };
