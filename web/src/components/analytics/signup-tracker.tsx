"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics";

/** Better Auth's `newUserCallbackURL` for Google carries this flag on a first sign-in. */
export const SIGNUP_PARAM = "signup";

/**
 * Records `sign_up_completed` for a first Google sign-in, then drops the flag from the URL.
 * The OAuth callback is a full page load, so checking once on mount is enough.
 */
export function SignupTracker() {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get(SIGNUP_PARAM) !== "google") return;
    track("sign_up_completed", { method: "google" });
    url.searchParams.delete(SIGNUP_PARAM);
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, []);
  return null;
}
