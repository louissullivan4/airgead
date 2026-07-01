// Irish capital allowances — wear & tear on plant & machinery (TCA 1997 s.284).
//
// The rules encoded here (verify against Revenue after each Budget):
//   - 12.5% straight-line per year over 8 years.
//   - The allowance starts in the tax year the asset comes into use (we use the
//     year of `acquired_date`) and is given in full for that year (no monthly
//     pro-rating for income tax).
//   - Passenger cars (`asset_type='motor_vehicle'`): allowable cost is capped
//     at the "specified amount" of €24,000. Lorries, tractors, horseboxes,
//     trailers etc. are `plant_machinery` — uncapped. (The CO₂-emissions
//     banding that can halve/deny the car cap is deliberately out of scope in
//     v1 and documented as such.)
//   - No wear & tear from the year of disposal onward. Balancing allowances /
//     charges on disposal are out of scope in v1 — the register records
//     disposal date + proceeds so the accountant can compute them.
//
// Everything here is a PURE function of the asset rows and a tax year —
// allowances are computed on demand, never stored, so there is no schedule
// state to drift.

const WEAR_AND_TEAR_RATE = 0.125;
const WRITE_OFF_YEARS = 8;
// "Specified amount" for passenger motor cars, TCA 1997 s.373.
const MOTOR_COST_CAP = 24000;

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// pg returns numeric as string and date as a Date (or string when mocked).
const toNumber = (v) => Number(v) || 0;
const yearOf = (d) => (d instanceof Date ? d.getFullYear() : new Date(d).getFullYear());

// Cost the allowance is computed on: capped for passenger cars.
const allowableCost = (asset) => {
    const cost = toNumber(asset.cost);
    return asset.asset_type === 'motor_vehicle' ? Math.min(cost, MOTOR_COST_CAP) : cost;
};

// The wear & tear allowance this asset earns in `year`. Zero before the
// acquisition year, zero once the 8 years are used up, zero from the year of
// disposal. The 8th year's allowance absorbs rounding so the eight allowances
// sum exactly to the allowable cost.
const allowanceForYear = (asset, year) => {
    const acquiredYear = yearOf(asset.acquired_date);
    if (year < acquiredYear) return 0;

    const yearIndex = year - acquiredYear; // 0-based
    if (yearIndex >= WRITE_OFF_YEARS) return 0;

    if (asset.disposal_date && year >= yearOf(asset.disposal_date)) return 0;

    const base = allowableCost(asset);
    const annual = round2(base * WEAR_AND_TEAR_RATE);
    if (yearIndex === WRITE_OFF_YEARS - 1) {
        return round2(base - annual * (WRITE_OFF_YEARS - 1));
    }
    return annual;
};

// Accumulated allowances up to (and excluding) `year` — drives the written-down
// value columns. At most 8 small iterations per asset.
const accumulatedTo = (asset, year) => {
    const acquiredYear = yearOf(asset.acquired_date);
    let sum = 0;
    for (let y = acquiredYear; y < year; y += 1) {
        sum += allowanceForYear(asset, y);
    }
    return round2(sum);
};

// The capital-allowances schedule for one tax year: a row per asset that is
// inside its 8-year write-off window that year (disposed assets stay visible in
// their disposal year, flagged, with a zero allowance), plus totals.
const scheduleForYear = (assets, year) => {
    const rows = (assets || [])
        .filter((asset) => {
            const acquiredYear = yearOf(asset.acquired_date);
            const inWindow = year >= acquiredYear && year < acquiredYear + WRITE_OFF_YEARS;
            const disposedBefore = asset.disposal_date && yearOf(asset.disposal_date) < year;
            return inWindow && !disposedBefore;
        })
        .map((asset) => {
            const base = allowableCost(asset);
            const allowance = allowanceForYear(asset, year);
            const openingWdv = round2(base - accumulatedTo(asset, year));
            const disposed = Boolean(asset.disposal_date && yearOf(asset.disposal_date) <= year);
            return {
                id: asset.id,
                expenseId: asset.expense_id || null,
                description: asset.description,
                assetType: asset.asset_type,
                category: asset.category || null,
                cost: toNumber(asset.cost),
                allowableCost: base,
                capped: base < toNumber(asset.cost),
                acquiredDate: asset.acquired_date,
                disposalDate: asset.disposal_date || null,
                disposalProceeds: asset.disposal_proceeds != null ? toNumber(asset.disposal_proceeds) : null,
                yearIndex: year - yearOf(asset.acquired_date) + 1, // 1..8 for display
                allowance,
                openingWdv,
                closingWdv: round2(openingWdv - allowance),
                disposed,
            };
        })
        .sort((a, b) => String(a.acquiredDate).localeCompare(String(b.acquiredDate)));

    const totals = rows.reduce(
        (acc, r) => ({
            cost: round2(acc.cost + r.cost),
            allowance: round2(acc.allowance + r.allowance),
            closingWdv: round2(acc.closingWdv + r.closingWdv),
        }),
        { cost: 0, allowance: 0, closingWdv: 0 },
    );

    return { rows, totals };
};

module.exports = {
    WEAR_AND_TEAR_RATE,
    WRITE_OFF_YEARS,
    MOTOR_COST_CAP,
    allowableCost,
    allowanceForYear,
    scheduleForYear,
};
