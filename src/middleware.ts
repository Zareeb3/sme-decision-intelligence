/**
 * Optional sign-in for company deployments.
 *
 * When BASIC_AUTH_USER and BASIC_AUTH_PASSWORD are set, every page and API
 * requires them (HTTP Basic authentication over HTTPS). The pipeline endpoint
 * /api/ingest uses its own token instead, so scheduled jobs need no password.
 * For larger rollouts, put the app behind the company's single sign-on proxy.
 */
import { NextResponse, type NextRequest } from "next/server";

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function middleware(req: NextRequest) {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASSWORD;
  if (!user || !pass) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith("/api/ingest")) return NextResponse.next();

  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const i = decoded.indexOf(":");
      if (i > 0 && safeEqual(decoded.slice(0, i), user) && safeEqual(decoded.slice(i + 1), pass)) return NextResponse.next();
    } catch {
      /* fall through */
    }
  }
  return new NextResponse("Sign-in required.", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Decision Intelligence", charset="UTF-8"' } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
