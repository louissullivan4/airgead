// Form 11 "Extracts From Accounts" expense lines. The accountant re-keys a
// sole trader's totals into these boxes every January — pre-bucketing the
// year's categories into the same shape is exactly the re-keying we remove.
//
// Buckets mirror the real Form 11 lines (Trading Account / Expenses and
// Deductions). Anything unmapped lands in "Other expenses" — correct-by-default
// rather than clever. Capital-linked expenses must be EXCLUDED by the caller
// (they are claimed via wear & tear, not as revenue expenses).

const FORM11_BUCKETS = [
    { key: 'purchases', label: 'Purchases (goods / materials / feed)' },
    { key: 'wages', label: 'Salaries, wages & staff costs' },
    { key: 'subcontractors', label: 'Sub-contractors' },
    { key: 'professional', label: 'Consultancy & professional fees' },
    { key: 'motor_travel', label: 'Motor, travel & subsistence' },
    { key: 'repairs', label: 'Repairs & renewals' },
    { key: 'other', label: 'Other expenses' },
];

// category slug → bucket key. Slugs come from config/categoryTemplates.js
// (org-editable, so owner-created slugs simply fall through to 'other').
const CATEGORY_TO_BUCKET = {
    // Purchases — goods for resale, materials, consumable stock.
    stock_purchases: 'purchases',
    materials: 'purchases',
    feed_bedding: 'purchases',
    animal_feed: 'purchases',
    fertiliser: 'purchases',
    seeds: 'purchases',
    food: 'purchases',
    beverage: 'purchases',
    alcohol: 'purchases',
    packaging: 'purchases',
    medication: 'purchases',

    // Staff.
    wages: 'wages',

    // Sub-contractors (RCT) / contractor charges.
    subcontractor: 'subcontractors',
    contractor: 'subcontractors',

    // Consultancy / professional fees.
    professional: 'professional',
    accountancy: 'professional',
    legal: 'professional',
    vet_fees: 'professional',
    farrier: 'professional',
    dentist: 'professional',

    // Motor, travel & subsistence.
    travel: 'motor_travel',
    fuel: 'motor_travel',
    diesel: 'motor_travel',
    mileage: 'motor_travel',
    motor_tax_insurance: 'motor_travel',
    vehicle_repairs: 'motor_travel',
    horsebox_maintenance: 'motor_travel',
    flights: 'motor_travel',
    accommodation: 'motor_travel',
    subsistence: 'motor_travel',

    // Repairs / renewals.
    machinery_repairs: 'repairs',
    repairs_maintenance: 'repairs',
    building_fencing: 'repairs',
};

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const toNumber = (v) => Number(v) || 0;

// Aggregate revenue-expense rows into the Form 11 buckets. `labelOf(slug)`
// resolves display labels from the org's category tree. Returns every bucket in
// the canonical order (zero buckets included — the accountant expects to see
// the whole shape of the form), each with its per-category breakdown.
const bucketise = (expenseRows, labelOf = (slug) => slug) => {
    const byBucket = new Map(FORM11_BUCKETS.map((b) => [b.key, new Map()]));

    for (const e of expenseRows || []) {
        const bucketKey = CATEGORY_TO_BUCKET[e.category] || 'other';
        const categories = byBucket.get(bucketKey);
        const entry = categories.get(e.category) || { slug: e.category, total: 0, count: 0 };
        entry.total = round2(entry.total + toNumber(e.amount));
        entry.count += 1;
        categories.set(e.category, entry);
    }

    return FORM11_BUCKETS.map((bucket) => {
        const categories = [...byBucket.get(bucket.key).values()]
            .map((c) => ({ ...c, label: labelOf(c.slug) }))
            .sort((a, b) => b.total - a.total);
        return {
            key: bucket.key,
            label: bucket.label,
            total: round2(categories.reduce((sum, c) => sum + c.total, 0)),
            categories,
        };
    });
};

module.exports = { FORM11_BUCKETS, CATEGORY_TO_BUCKET, bucketise };
