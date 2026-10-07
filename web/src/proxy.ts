import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// Optimistic redirects from the cookie's presence only. Real authorization
// happens server-side in lib/auth-guards.ts (layouts, pages, Server Actions).
const SIGNED_OUT_ONLY = ["/sign-in", "/sign-up", "/forgot-password", "/reset-password"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = !!getSessionCookie(request);

  if (!hasSession && (pathname.startsWith("/app") || pathname.startsWith("/admin"))) {
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }

  // `reauth` is set by requireSession() when the cookie exists but the session
  // is expired/revoked; without it a stale cookie would loop /app <-> /sign-in.
  if (hasSession && SIGNED_OUT_ONLY.includes(pathname) && !request.nextUrl.searchParams.has("reauth")) {
    return NextResponse.redirect(new URL("/app", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*", "/admin/:path*", "/sign-in", "/sign-up", "/forgot-password", "/reset-password"],
};
