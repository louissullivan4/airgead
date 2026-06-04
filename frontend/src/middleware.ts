import { NextRequest, NextResponse } from "next/server";
import { TOKEN_COOKIE, AUTH_PATHS } from "@/lib/constants";

// Route guard: unauthenticated users are sent to /login; authenticated users
// hitting an auth page are sent to /home. Presence of the cookie is sufficient
// here — the proxy enforces real validity and clears the cookie on a 401.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasToken = req.cookies.has(TOKEN_COOKIE);
  const isAuthPath = AUTH_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (!hasToken && !isAuthPath) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (hasToken && isAuthPath) {
    const url = req.nextUrl.clone();
    url.pathname = "/home";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Skip API routes, Next internals, and static/PWA assets.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|manifest.json|sw.js|icons).*)",
  ],
};
