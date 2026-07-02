"use client";

import { Banknote, Calculator, Landmark, ReceiptText } from "lucide-react";
import { formatCurrency, type TaxSummary } from "@/lib/api";
import { StatCard, StatGrid } from "@/components/stat-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const ASSET_TYPE_LABELS: Record<string, string> = {
  plant_machinery: "Plant & machinery",
  motor_vehicle: "Motor vehicle (car)",
};

const VAT_STATUS_LABELS: Record<string, string> = {
  not_registered: "Not VAT registered",
  registered: "VAT registered",
  flat_rate_farmer: "Flat-rate farmer (unregistered)",
};

/**
 * The year's full tax picture: Form 11-shaped expense buckets, the capital
 * allowances schedule, and the VAT position. Pure display - fed by
 * /reports/tax-summary (own org) or the accountant's client twin.
 */
function TaxSummaryView({ summary }: { summary: TaxSummary }) {
  const { totals, form11, capitalAllowances, vat } = summary;

  return (
    <div className="space-y-5">
      <StatGrid>
        <StatCard
          label="Income"
          value={formatCurrency(totals.income)}
          icon={Banknote}
          tone="success"
        />
        <StatCard
          label="Allowable expenses"
          value={formatCurrency(totals.revenueExpenses)}
          icon={ReceiptText}
          hint="Revenue expenses only"
        />
        <StatCard
          label="Capital allowances"
          value={formatCurrency(totals.wearAndTear)}
          icon={Landmark}
          hint={`Wear & tear on ${summary.counts.assets} asset${summary.counts.assets === 1 ? "" : "s"}`}
        />
        <StatCard
          label="Est. profit"
          value={formatCurrency(totals.netBeforeAdjustments)}
          icon={Calculator}
          hint="Before accountant adjustments"
          emphasis
        />
      </StatGrid>

      <Card>
        <CardHeader>
          <CardTitle>Form 11 - extracts from accounts</CardTitle>
          <CardDescription>
            The year&apos;s revenue expenses, pre-sorted into the boxes the return asks for.
            Capital items are excluded here - they&apos;re claimed below instead.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <table className="w-full border-collapse text-sm">
            <tbody>
              {form11.map((bucket) => (
                <tr key={bucket.key} className="border-b border-border/60 last:border-0">
                  <td className="py-2.5 pr-3">
                    <div className="font-medium">{bucket.label}</div>
                    {bucket.categories.length > 0 && (
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {bucket.categories.map((c) => `${c.label} ${formatCurrency(c.total)}`).join(" · ")}
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-2.5 text-right align-top font-medium tabular-nums">
                    {formatCurrency(bucket.total)}
                  </td>
                </tr>
              ))}
              <tr>
                <td className="pt-3 font-semibold">Total allowable expenses</td>
                <td className="whitespace-nowrap pt-3 text-right font-semibold tabular-nums">
                  {formatCurrency(totals.revenueExpenses)}
                </td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Capital allowances - wear &amp; tear schedule</CardTitle>
          <CardDescription>
            Plant, machinery &amp; vehicles written off at 12.5% a year over 8 years.
            {totals.capitalExpenditure > 0 &&
              ` ${formatCurrency(totals.capitalExpenditure)} of capital spend captured this year.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {capitalAllowances.rows.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No assets in the register for {summary.year}. Mark an expense as a capital item -
              or add an opening asset - and its allowance appears here.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-xs font-medium text-muted-foreground">
                    <th className="py-2 pr-3 text-left">Asset</th>
                    <th className="px-3 py-2 text-left">Year</th>
                    <th className="px-3 py-2 text-right">Cost</th>
                    <th className="px-3 py-2 text-right">Opening WDV</th>
                    <th className="px-3 py-2 text-right">Allowance</th>
                    <th className="py-2 pl-3 text-right">Closing WDV</th>
                  </tr>
                </thead>
                <tbody>
                  {capitalAllowances.rows.map((row) => (
                    <tr key={row.id} className="border-b border-border/60">
                      <td className="py-2.5 pr-3">
                        <div className="font-medium">{row.description}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          {ASSET_TYPE_LABELS[row.assetType] ?? row.assetType}
                          <span>· acquired {new Date(row.acquiredDate).toLocaleDateString()}</span>
                          {row.capped && <Badge variant="secondary">€24k car cap</Badge>}
                          {row.disposed && <Badge variant="secondary">Disposed</Badge>}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                        {row.yearIndex} of 8
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                        {formatCurrency(row.cost)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                        {formatCurrency(row.openingWdv)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium tabular-nums">
                        {formatCurrency(row.allowance)}
                      </td>
                      <td className="whitespace-nowrap py-2.5 pl-3 text-right tabular-nums text-muted-foreground">
                        {formatCurrency(row.closingWdv)}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td className="pt-3 font-semibold" colSpan={2}>
                      Total
                    </td>
                    <td className="whitespace-nowrap px-3 pt-3 text-right font-semibold tabular-nums">
                      {formatCurrency(capitalAllowances.totals.cost)}
                    </td>
                    <td />
                    <td className="whitespace-nowrap px-3 pt-3 text-right font-semibold tabular-nums">
                      {formatCurrency(capitalAllowances.totals.allowance)}
                    </td>
                    <td className="whitespace-nowrap pt-3 pl-3 text-right font-semibold tabular-nums">
                      {formatCurrency(capitalAllowances.totals.closingWdv)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>VAT position</CardTitle>
          <CardDescription>{VAT_STATUS_LABELS[vat.vatStatus] ?? vat.vatStatus}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="space-y-2.5 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">VAT captured on purchases</dt>
              <dd className="font-medium tabular-nums">{formatCurrency(vat.vatOnPurchases)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">VAT captured on income</dt>
              <dd className="font-medium tabular-nums">{formatCurrency(vat.vatOnIncome)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Reclaimable via VAT returns</dt>
              <dd className="font-medium">{vat.inputVatReclaimable ? "Yes" : "No"}</dd>
            </div>
            {vat.flatRateAddition != null && (
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Flat-rate addition ({summary.year})</dt>
                <dd className="font-medium tabular-nums">{(vat.flatRateAddition * 100).toFixed(1)}%</dd>
              </div>
            )}
            {vat.vatStatus !== "registered" && vat.vat58EligibleSpend > 0 && (
              <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                {formatCurrency(vat.vat58EligibleSpend)} spent on farm buildings / fencing /
                drainage this year may qualify for a VAT&nbsp;58 reclaim even without VAT
                registration - worth raising with the accountant.
              </p>
            )}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

export { TaxSummaryView };
