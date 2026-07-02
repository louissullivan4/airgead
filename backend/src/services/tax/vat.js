// VAT position for the tax summary, driven by `organisations.vat_status`:
//
//   'registered'       - normal VAT accounting: input VAT on purchases is
//                        reclaimable; we total the captured `tax_amount`s.
//   'not_registered'   - VAT is just a cost; totals shown for information.
//   'flat_rate_farmer' - unregistered farmer on the flat-rate scheme: adds the
//                        flat-rate addition to sales to VAT-registered buyers
//                        instead of reclaiming input VAT. May still reclaim VAT
//                        on farm buildings/structures, fencing, land drainage
//                        via the VAT 58 procedure - we total spend in
//                        vat58-flagged categories as a prompt.
//
// Flat-rate addition by year (set each Budget - VERIFY against Revenue
// annually; unknown years fall back to the latest known rate):
const FLAT_RATE_ADDITION_BY_YEAR = {
    2023: 0.05,
    2024: 0.048,
    2025: 0.051,
};
const LATEST_KNOWN_FLAT_RATE = 0.051;

// Fallback for org category trees created before the `vat58` node flag existed.
const KNOWN_VAT58_SLUGS = ['building_fencing'];

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const toNumber = (v) => Number(v) || 0;

const flatRateAdditionFor = (year) =>
    FLAT_RATE_ADDITION_BY_YEAR[year] ?? LATEST_KNOWN_FLAT_RATE;

// Collect the vat58-flagged slugs from an org's category tree (plus the known
// fallback set) - tolerant of trees without metadata.
const vat58Slugs = (tree) => {
    const slugs = new Set(KNOWN_VAT58_SLUGS);
    const walk = (nodes) =>
        (nodes || []).forEach((n) => {
            if (n.vat58) slugs.add(n.slug);
            walk(n.children);
        });
    walk(tree && tree.expense);
    return slugs;
};

// Build the VAT section of the tax summary from the year's raw expense rows.
// `expenses` includes income rows (category === 'income').
const vatSummary = ({ vatStatus, expenses, year, tree }) => {
    const status = vatStatus || 'not_registered';
    const eligible = vat58Slugs(tree);

    let vatOnPurchases = 0;
    let vatOnIncome = 0;
    let vat58EligibleSpend = 0;

    for (const e of expenses || []) {
        const tax = toNumber(e.tax_amount);
        if (e.category === 'income') {
            vatOnIncome += tax;
        } else {
            vatOnPurchases += tax;
            if (eligible.has(e.category)) vat58EligibleSpend += toNumber(e.amount);
        }
    }

    return {
        vatStatus: status,
        // Input VAT is only reclaimable through VAT returns when registered.
        inputVatReclaimable: status === 'registered',
        vatOnPurchases: round2(vatOnPurchases),
        vatOnIncome: round2(vatOnIncome),
        // Flat-rate farmers: the % addition applied to sales to registered buyers.
        flatRateAddition: status === 'flat_rate_farmer' ? flatRateAdditionFor(year) : null,
        // Prompt for the VAT 58 reclaim (farm buildings/fencing/drainage) -
        // relevant to unregistered/flat-rate farmers only; UI decides display.
        vat58EligibleSpend: round2(vat58EligibleSpend),
    };
};

module.exports = {
    FLAT_RATE_ADDITION_BY_YEAR,
    LATEST_KNOWN_FLAT_RATE,
    KNOWN_VAT58_SLUGS,
    flatRateAdditionFor,
    vatSummary,
};
