import { NextRequest, NextResponse } from "next/server";
import { BACKEND_URL, TOKEN_COOKIE } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

// Forward only the response headers the client actually needs. Notably skips
// transfer-encoding/content-encoding which can break re-streaming.
function passthroughHeaders(backendRes: Response): Headers {
  const headers = new Headers();
  for (const name of ["content-type", "content-disposition", "content-length"]) {
    const value = backendRes.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

async function handle(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const { path } = await ctx.params;
  const token = req.cookies.get(TOKEN_COOKIE)?.value;
  const target = `${BACKEND_URL}/${path.join("/")}${req.nextUrl.search}`;

  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const contentType = req.headers.get("content-type");
  if (contentType) headers["content-type"] = contentType;

  const method = req.method;
  const hasBody = method !== "GET" && method !== "HEAD";
  const body = hasBody ? await req.text() : undefined;

  const backendRes = await fetch(target, { method, headers, body });

  // Phase 0: a 401 means the session is invalid (expired, or token missing
  // orgId). Clear the cookie so middleware/the client redirect to login.
  if (backendRes.status === 401) {
    const res = new NextResponse(await backendRes.text(), {
      status: 401,
      headers: passthroughHeaders(backendRes),
    });
    res.cookies.delete(TOKEN_COOKIE);
    return res;
  }

  return new NextResponse(backendRes.body, {
    status: backendRes.status,
    headers: passthroughHeaders(backendRes),
  });
}

export {
  handle as GET,
  handle as POST,
  handle as PUT,
  handle as PATCH,
  handle as DELETE,
};
