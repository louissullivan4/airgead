import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { TOKEN_COOKIE, decodeJwt } from "@/lib/auth-server";

// Returns the decoded JWT claims for the current session (or null). Used by the
// client to know the user id / org role without exposing the raw token.
export async function GET() {
  const token = (await cookies()).get(TOKEN_COOKIE)?.value;
  const claims = token ? decodeJwt(token) : null;
  if (!claims?.userId) return NextResponse.json(null);

  return NextResponse.json({
    userId: claims.userId,
    role: claims.role,
    orgId: claims.orgId,
    orgRole: claims.orgRole,
    platformRole: claims.platformRole,
  });
}
