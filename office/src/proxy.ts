import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// Optimistic redirects from the cookie's presence only. Real authorization happens server-side
// in lib/auth-guards.ts (layouts, pages, Server Actions) and in the BFF.
const COOKIE_PREFIX = "documind-office";

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = !!getSessionCookie(request, { cookiePrefix: COOKIE_PREFIX });

  if (pathname === "/sign-in") {
    // `reauth` is set by requireSession() when the cookie exists but the session is expired,
    // revoked or banned; without it a stale cookie would loop / <-> /sign-in.
    if (hasSession && !request.nextUrl.searchParams.has("reauth")) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (!hasSession) {
    const url = new URL("/sign-in", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Everything but the auth and BFF routes (they answer 401 themselves), Next internals,
  // robots.txt (the health check), the icon and static assets.
  matcher: ["/((?!api/|_next/|robots.txt|icon.svg|favicon.ico|assets/|video/).*)"],
};
