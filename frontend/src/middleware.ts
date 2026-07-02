import { NextRequest, NextResponse } from "next/server";
import { TOKEN_COOKIE, AUTH_PATHS } from "@/lib/constants";

// Route guard: unauthenticated users may see the public landing page ("/") and
// the auth pages; everything else redirects to /login. Authenticated users
// hitting the landing or an auth page are sent to /home. Presence of the cookie
// is sufficient here - the proxy enforces real validity and clears it on a 401.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasToken = req.cookies.has(TOKEN_COOKIE);
  const isAuthPath = AUTH_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  // The marketing landing page at "/" is publicly accessible.
  const isLanding = pathname === "/";

  // The offline fallback must be reachable by anyone, in any auth state.
  if (pathname === "/offline") return NextResponse.next();

  if (!hasToken && !isAuthPath && !isLanding) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (hasToken && (isAuthPath || isLanding)) {
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
