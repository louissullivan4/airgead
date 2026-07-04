// Display COPY for the marketing pricing pages and the Settings billing card.
// The price NUMBER is not authoritative here - it comes live from Stripe via
// GET /billing/plans (see lib/plans.ts), so editing the price in the Stripe
// dashboard updates the site. These constants are the tier names, taglines and
// feature lists, plus a fallback amount used only when the live price can't be
// fetched. Keep TRIAL_DAYS in sync with the backend (config/tiers.js).

export const TRIAL_DAYS = 14;

export const PRICING = {
  currency: "€",
  free: {
    name: "Free trial",
    tagline: "The full product, free while you try it. No card required.",
    features: [
      "Unlimited expenses, income & receipt capture",
      "Irish tax engine: capital allowances, VAT, Form 11 pre-sort",
      "Tax-year exports (Excel, CSV, receipt archive)",
      "Invite your accountant for free read access",
    ],
  },
  premium: {
    name: "Premium",
    // Display-only fallback, shown only if the live Stripe price is unavailable.
    fallbackPrice: 15,
    unit: "per month",
    tagline: "Everything in the trial, kept on - one simple monthly price.",
    features: [
      "Everything in the free trial, uninterrupted",
      "Unlimited history and tax-year exports",
      "Invite your accountant for free read access",
      "Cancel anytime - your records always stay viewable",
    ],
  },
} as const;
