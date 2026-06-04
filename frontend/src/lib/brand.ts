// Single source of truth for the product name on the frontend.
// Mirror of backend/src/config/brand.js. Reference BRAND instead of hardcoding.
export const BRAND = "rian";
export const BRAND_LEGACY = "EquiLedger";

// Brand primary colour. Anchored on Carbon's purple-60 (AA-tested) so it matches
// the Sass theme override in src/styles/theme.scss. Consumed by the PWA manifest
// and any inline UI that needs the hex (charts, theme-color meta, etc.).
export const BRAND_PRIMARY = "#8a3ffc";
