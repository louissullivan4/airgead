/* eslint-disable no-undef */
const { expect } = require('@jest/globals');

const {
    WRITE_OFF_YEARS,
    MOTOR_COST_CAP,
    allowableCost,
    allowanceForYear,
    scheduleForYear,
} = require('../src/services/tax/wearAndTear');

const asset = (overrides = {}) => ({
    id: 'a1',
    description: 'Tractor',
    asset_type: 'plant_machinery',
    cost: '8000',            // pg numeric arrives as a string
    acquired_date: '2024-03-10',
    disposal_date: null,
    disposal_proceeds: null,
    ...overrides,
});

describe('wear & tear engine (12.5% straight-line over 8 years)', () => {
    it('gives 12.5% of cost each year from the acquisition year', () => {
        expect(allowanceForYear(asset(), 2024)).toBe(1000);
        expect(allowanceForYear(asset(), 2025)).toBe(1000);
        expect(allowanceForYear(asset(), 2031)).toBe(1000); // 8th and final year
    });

    it('gives nothing before acquisition or after the 8 years are used up', () => {
        expect(allowanceForYear(asset(), 2023)).toBe(0);
        expect(allowanceForYear(asset(), 2032)).toBe(0);
    });

    it('caps a passenger car at the €24,000 specified amount', () => {
        const car = asset({ asset_type: 'motor_vehicle', cost: '60000' });
        expect(allowableCost(car)).toBe(MOTOR_COST_CAP);
        expect(allowanceForYear(car, 2024)).toBe(3000); // 24,000 / 8
    });

    it('does NOT cap plant/machinery (lorries, horseboxes, tractors…)', () => {
        const lorry = asset({ cost: '60000' });
        expect(allowableCost(lorry)).toBe(60000);
        expect(allowanceForYear(lorry, 2024)).toBe(7500);
    });

    it('the 8 yearly allowances sum exactly to the allowable cost (rounding absorbed in year 8)', () => {
        const awkward = asset({ cost: '1000.10' }); // 125.01 × 7 = 875.07, year 8 = 125.03
        let total = 0;
        for (let y = 2024; y < 2024 + WRITE_OFF_YEARS; y += 1) {
            total += allowanceForYear(awkward, y);
        }
        expect(Math.round(total * 100) / 100).toBe(1000.1);
    });

    it('stops allowances from the year of disposal', () => {
        const sold = asset({ disposal_date: '2026-06-01' });
        expect(allowanceForYear(sold, 2025)).toBe(1000);
        expect(allowanceForYear(sold, 2026)).toBe(0);
        expect(allowanceForYear(sold, 2027)).toBe(0);
    });

    describe('scheduleForYear', () => {
        it('builds per-asset rows with WDV columns and totals', () => {
            const { rows, totals } = scheduleForYear([asset()], 2025);
            expect(rows).toHaveLength(1);
            expect(rows[0]).toEqual(expect.objectContaining({
                yearIndex: 2,          // second year of eight
                allowance: 1000,
                openingWdv: 7000,      // 8000 − year-1 allowance
                closingWdv: 6000,
                capped: false,
                disposed: false,
            }));
            expect(totals).toEqual({ cost: 8000, allowance: 1000, closingWdv: 6000 });
        });

        it('excludes assets outside their write-off window or disposed in prior years', () => {
            const old = asset({ id: 'old', acquired_date: '2010-01-01' });
            const future = asset({ id: 'future', acquired_date: '2027-01-01' });
            const soldEarlier = asset({ id: 'sold', disposal_date: '2024-12-01' });
            const { rows } = scheduleForYear([old, future, soldEarlier, asset({ id: 'live' })], 2025);
            expect(rows.map((r) => r.id)).toEqual(['live']);
        });

        it('keeps an asset disposed THIS year visible, flagged, with zero allowance', () => {
            const { rows } = scheduleForYear([asset({ disposal_date: '2025-05-01' })], 2025);
            expect(rows).toHaveLength(1);
            expect(rows[0].disposed).toBe(true);
            expect(rows[0].allowance).toBe(0);
        });
    });
});
