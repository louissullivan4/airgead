// Single source of truth for the product name. Going forward, reference BRAND
// instead of hardcoding the name in strings, emails, logs, etc.
//
// BRAND_LEGACY is the pre-rename name; it is kept only so tooling (and the
// `npm run check:brand` regression check) can detect stray old references.
const BRAND = 'airgead';
const BRAND_LEGACY = 'EquiLedger';

module.exports = { BRAND, BRAND_LEGACY };
