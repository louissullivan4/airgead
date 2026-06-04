import { NextResponse } from "next/server";
import { BACKEND_URL, TOKEN_COOKIE, tokenCookieOptions } from "@/lib/auth-server";

// Self-serve and invite-based signup both POST here. Forwards to the backend
// registration endpoint (which provisions/joins an org and returns a token),
// then sets the httpOnly cookie so the new user is logged straight in.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  let backendRes: Response;
  try {
    backendRes = await fetch(`${BACKEND_URL}/users/register`, {
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
      { error: data.error ?? "Signup failed." },
      { status: backendRes.status },
    );
  }

  const { token, ...user } = data as { token: string; [k: string]: unknown };
  const res = NextResponse.json({
    id: user.id,
    name: user.name ?? user.fname,
    email: user.email,
    role: user.role,
  });
  if (token) res.cookies.set(TOKEN_COOKIE, token, tokenCookieOptions());
  return res;
}
