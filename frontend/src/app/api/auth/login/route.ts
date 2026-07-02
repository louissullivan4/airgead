import { NextResponse } from "next/server";
import { BACKEND_URL, TOKEN_COOKIE, tokenCookieOptions } from "@/lib/auth-server";

// Exchange credentials for a JWT, then stash the token in an httpOnly cookie so
// it never reaches client JS. Returns the flat user object (no token).
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  let backendRes: Response;
  try {
    backendRes = await fetch(`${BACKEND_URL}/users/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return NextResponse.json(
      { error: "Could not reach the server. Please try again." },
      { status: 502 },
    );
  }

  const data = await backendRes.json().catch(() => ({}));
  if (!backendRes.ok) {
    return NextResponse.json(
      // `code` (e.g. 'email_unverified') lets the login page branch its UX.
      { error: data.error ?? "Invalid email or password.", code: data.code },
      { status: backendRes.status },
    );
  }

  const { token, ...user } = data as { token: string; [k: string]: unknown };
  const res = NextResponse.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  });
  res.cookies.set(TOKEN_COOKIE, token, tokenCookieOptions());
  return res;
}
