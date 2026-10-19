import { NOT_ADMIN_CODE, NOT_ADMIN_MESSAGE } from "./admin";

/** Only same-origin relative paths; anything else falls back. Blocks `//evil.com` and `/\evil.com`. */
export function safeNext(value: string | null | undefined, fallback = "/"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}

/**
 * Inline copy for a sign-in failure: a Better Auth error code from the email form, or the
 * `?error=` code the Google callback redirects with.
 */
export function signInErrorMessage(code: string | null | undefined, fallback?: string): string | null {
  switch (code) {
    case null:
    case undefined:
    case "":
      return fallback ?? null;
    case NOT_ADMIN_CODE:
      return NOT_ADMIN_MESSAGE;
    case "INVALID_EMAIL_OR_PASSWORD":
      return "That email and password don't match a DocuMind account. Check them and try again.";
    case "EMAIL_NOT_VERIFIED":
      return "This account's email isn't verified yet. Verify it in DocuMind, then sign in here.";
    case "signup_disabled":
    case "SIGNUP_DISABLED":
      return "No DocuMind account uses that Google address. Evaluation only signs in existing DocuMind admins.";
    case "account_not_linked":
      return "That Google account isn't linked to your DocuMind account. Sign in with your email and password.";
    default:
      return fallback ?? "Sign-in didn't complete. Try again, or use your email and password.";
  }
}
