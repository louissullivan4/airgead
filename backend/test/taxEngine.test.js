/* eslint-disable no-undef */
const { expect } = require('@jest/globals');

const { bucketise, FORM11_BUCKETS } = require('../src/services/tax/form11');
const { vatSummary, flatRateAdditionFor } = require('../src/services/tax/vat');

describe('Form 11 bucketing', () => {
    const rows = [
        { category: 'feed_bedding', amount: '540' },     // → purchases
        { category: 'materials', amount: '100.50' },     // → purchases
        { category: 'fuel', amount: '95.40' },           // → motor_travel
        { category: 'vet_fees', amount: '180' },         // → professional
        { category: 'made_up_by_owner', amount: '20' },  // → other (unmapped slug)
    ];

    it('aggregates category totals into the real Form 11 expense lines', () => {
        const buckets = bucketise(rows, (slug) => slug.toUpperCase());
        const byKey = Object.fromEntries(buckets.map((b) => [b.key, b]));

        expect(byKey.purchases.total).toBe(640.5);
        expect(byKey.motor_travel.total).toBe(95.4);
        expect(byKey.professional.total).toBe(180);
        expect(byKey.other.total).toBe(20);
        // labels resolved through the org tree lookup
        expect(byKey.purchases.categories.map((c) => c.label)).toEqual(
            expect.arrayContaining(['FEED_BEDDING', 'MATERIALS']),
        );
    });

    it('returns every bucket in canonical order, including zeros (the whole form shape)', () => {
        const buckets = bucketise([]);
        expect(buckets.map((b) => b.key)).toEqual(FORM11_BUCKETS.map((b) => b.key));
        expect(buckets.every((b) => b.total === 0)).toBe(true);
    });
});

describe('VAT summary', () => {
    const expenses = [
        { category: 'income', amount: '1230', tax_amount: '230' },
        { category: 'feed_bedding', amount: '123', tax_amount: '23' },
        { category: 'building_fencing', amount: '2000', tax_amount: '460' },
    ];

    it('totals captured VAT and flags reclaimability for a registered org', () => {
        const vat = vatSummary({ vatStatus: 'registered', expenses, year: 2025 });
        expect(vat.inputVatReclaimable).toBe(true);
        expect(vat.vatOnPurchases).toBe(483);
        expect(vat.vatOnIncome).toBe(230);
        expect(vat.flatRateAddition).toBeNull();
    });

    it('gives a flat-rate farmer the year rate + the VAT 58 spend prompt', () => {
        const vat = vatSummary({ vatStatus: 'flat_rate_farmer', expenses, year: 2025 });
        expect(vat.inputVatReclaimable).toBe(false);
        expect(vat.flatRateAddition).toBe(0.051);
        expect(vat.vat58EligibleSpend).toBe(2000); // building_fencing spend
    });

    it('uses the per-year flat-rate table with a latest-known fallback', () => {
        expect(flatRateAdditionFor(2024)).toBe(0.048);
        expect(flatRateAdditionFor(2023)).toBe(0.05);
        expect(flatRateAdditionFor(2099)).toBe(0.051); // fallback until the Budget table is updated
    });

    it('also counts vat58-flagged slugs from a custom org tree', () => {
        const tree = { expense: [{ slug: 'farm_shed', label: 'Farm shed', vat58: true }], income: [] };
        const vat = vatSummary({
            vatStatus: 'flat_rate_farmer',
            expenses: [{ category: 'farm_shed', amount: '900', tax_amount: null }],
            year: 2025,
            tree,
        });
        expect(vat.vat58EligibleSpend).toBe(900);
    });

    it('defaults to not_registered when the org has no status yet', () => {
        const vat = vatSummary({ vatStatus: undefined, expenses: [], year: 2025 });
        expect(vat.vatStatus).toBe('not_registered');
        expect(vat.inputVatReclaimable).toBe(false);
    });
});
