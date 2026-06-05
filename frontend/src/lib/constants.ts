// Shared constants safe to import from any runtime (edge middleware included).
// Keep this free of server-only / Node APIs.

export const TOKEN_COOKIE = "rian_token";

// Pages reachable without a session. Everything else requires the auth cookie.
export const AUTH_PATHS = ["/login", "/signup", "/forgot-password", "/reset-password"];

// Phase 2 OCR auto-fill feature flag. DORMANT by default: when false, the camera
// capture flow goes straight to the manual form — no OCR auto-fill UI renders and
// no parsed data is used. Mirror of the backend OCR_PROVIDER/OCR_AUTOFILL_ENABLED
// switches. Inlined at build time (NEXT_PUBLIC_*), safe in client + edge runtimes.
export const OCR_AUTOFILL_ENABLED =
  process.env.NEXT_PUBLIC_OCR_AUTOFILL_ENABLED === "true";
