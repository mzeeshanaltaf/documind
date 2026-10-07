/** Only same-origin relative paths; anything else falls back. Blocks `//evil.com` and `/\evil.com`. */
export function safeNext(value: string | null | undefined, fallback = "/app"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}

export function withParams(path: string, params: Record<string, string | null | undefined>) {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) search.set(k, v);
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

/** Calm, specific copy for Better Auth error codes; falls back to the server's message. */
export function authErrorMessage(error: { code?: string; message?: string } | null | undefined, fallback: string) {
  switch (error?.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return "That email and password don't match. Check them and try again.";
    case "INVALID_OTP":
      return "That code isn't right. Check the latest email and try again.";
    case "OTP_EXPIRED":
      return "That code has expired. Send a new one below.";
    case "TOO_MANY_ATTEMPTS":
      return "Too many attempts with that code. Send a new one below.";
    case "PASSWORD_TOO_SHORT":
      return "Use at least 8 characters for your password.";
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "An account with this email already exists. Sign in instead.";
    case "BANNED_USER":
      return "This account has been suspended. Contact your administrator.";
    default:
      if (error?.message && !/^\w+$/.test(error.message)) return error.message;
      return fallback;
  }
}

export const OTP_LENGTH = 6;
export const RESEND_COOLDOWN_SECONDS = 60;
