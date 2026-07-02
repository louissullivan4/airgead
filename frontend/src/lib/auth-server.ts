import "server-only";
import { TOKEN_COOKIE } from "@/lib/constants";

export { TOKEN_COOKIE };

// Backend base URL as seen from the Next.js server (inside Docker this is the
// service name; locally it falls back to localhost). This is the only place the
// frontend talks to the API directly - the browser always goes via /api/proxy.
export const BACKEND_URL =
  process.env.BACKEND_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

const TOKEN_MAX_AGE_SECONDS = 60 * 60 * 168; // 7 days, matches the JWT's 168h expiry

export interface JwtClaims {
  userId: string;
  role: "user" | "admin" | "accountant";
  orgId?: string;
  orgRole?: "owner" | "member";
  platformRole?: "user" | "super_admin";
  exp?: number;
}

/**
 * Decode the JWT payload without verifying the signature. The backend is the
 * source of truth on verification; here we only read claims (userId, orgRole…)
 * to drive the UI, so an unverified decode is acceptable and avoids shipping the
 * JWT secret to the frontend.
 */
export function decodeJwt(token: string): JwtClaims | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = Buffer.from(payload, "base64url").toString("utf8");
    return JSON.parse(json) as JwtClaims;
  } catch {
    return null;
  }
}

export function tokenCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: TOKEN_MAX_AGE_SECONDS,
  };
}
