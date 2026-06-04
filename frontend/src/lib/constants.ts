// Shared constants safe to import from any runtime (edge middleware included).
// Keep this free of server-only / Node APIs.

export const TOKEN_COOKIE = "rian_token";

// Pages reachable without a session. Everything else requires the auth cookie.
export const AUTH_PATHS = ["/login", "/signup", "/forgot-password", "/reset-password"];
