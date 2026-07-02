// Display-only pricing constants. What Stripe ACTUALLY charges comes from the
// STRIPE_PRICE_SOLO / STRIPE_PRICE_SEAT price ids configured on the backend -
// whoever edits prices in the Stripe dashboard must keep these in sync.

export const TRIAL_DAYS = 30;

export const PRICING = {
  currency: "€",
  solo: {
    name: "Solo",
    price: 9,
    unit: "per business / month",
    tagline: "For sole traders and freelancers running their own books.",
    features: [
      "Unlimited expenses, income & receipt capture",
      "Irish tax engine: capital allowances, VAT, Form 11 pre-sort",
      "Tax-year exports (Excel, CSV, receipt archive)",
      "Invite your accountant for free read access",
    ],
  },
  practice: {
    name: "Practice",
    price: 7,
    unit: "per client seat / month",
    tagline: "For accountancy practices. Your own account is free - pay only for active client seats.",
    features: [
      "Free practice workspace for your whole team",
      "Every client's records, tax summary & readiness at a glance",
      "One-click year-end export packs per client",
      "Seats added and removed as you invite or revoke clients",
    ],
  },
} as const;
