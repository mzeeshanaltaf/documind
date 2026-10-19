import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { isPlatformAdmin, NOT_ADMIN_CODE } from "./admin";
import { auth, type Session } from "./auth";

/** The current session, read once per request. Null when signed out. */
export const getSession = cache(async (): Promise<Session | null> => {
  return auth.api.getSession({ headers: await headers() });
});

/**
 * Every layout, page and Server Action calls this. Sign-in already refuses non-admins; this
 * catches an admin demoted or banned in DocuMind after signing in here (the session read is
 * uncached, so `role` and `banned` are current).
 */
export async function requireAdmin(): Promise<Session> {
  const session = await getSession();
  // A cookie the proxy accepted but the server rejected (expired or revoked).
  if (!session) redirect("/sign-in?reauth=1");
  if (!isPlatformAdmin(session.user)) redirect(`/sign-in?reauth=1&error=${NOT_ADMIN_CODE}`);
  return session;
}
