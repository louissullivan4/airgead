import "server-only";
import { BACKEND_URL } from "@/lib/auth-server";

// Public plan data for the marketing pages, fetched server-side from the
// backend's PUBLIC GET /billing/plans. Marketing pages are public server
// components, so this never runs in the browser and needs no auth. The price
// is sourced live from Stripe on the backend, so editing it in the Stripe
// dashboard updates the site.

export interface PriceInfo {
  amount: number; // minor units, e.g. 1500 = €15.00
  currency: string; // ISO code, lowercase (Stripe convention)
  interval: string | null; // 'month' | 'year' | null
}

export interface PublicPlans {
  /** False = "complete demo mode": show the free story, hide paid tiers. */
  enforced: boolean;
  trialDays: number;
  premium: PriceInfo | null;
  seat: PriceInfo | null;
}

// Safe fallback so a page always renders even if the backend is unreachable
// (e.g. during `next build`, which runs with no backend). Defaults to demo
// mode - the least surprising state to show if we can't confirm enforcement.
const FALLBACK: PublicPlans = { enforced: false, trialDays: 14, premium: null, seat: null };

export async function getPublicPlans(): Promise<PublicPlans> {
  try {
    // no-store keeps this out of the build-time static cache (the backend isn't
    // reachable then) and reflects Stripe price edits on the next request; the
    // backend already memoises the Stripe call for a few minutes.
    const res = await fetch(`${BACKEND_URL}/billing/plans`, { cache: "no-store" });
    if (!res.ok) throw new Error(`billing/plans ${res.status}`);
    return (await res.json()) as PublicPlans;
  } catch {
    return FALLBACK;
  }
}

// Format a live price (or a whole-currency fallback amount) for display.
// e.g. { amount: 1500, currency: "eur" } -> "€15".
export function formatPrice(
  price: PriceInfo | null,
  fallbackAmount: number,
  fallbackCurrency = "EUR",
): string {
  const currency = (price?.currency ?? fallbackCurrency).toUpperCase();
  const major = price ? price.amount / 100 : fallbackAmount;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      // Whole amounts read cleaner on a pricing card; show cents only if present.
      minimumFractionDigits: Number.isInteger(major) ? 0 : 2,
    }).format(major);
  } catch {
    return `€${major}`;
  }
}
