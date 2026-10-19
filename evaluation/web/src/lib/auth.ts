import "server-only";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { isPlatformAdmin, NOT_ADMIN_CODE, NOT_ADMIN_MESSAGE } from "./admin";
import { pool } from "./db";

/**
 * Better Auth on DocuMind's own auth tables (EVAL_AUTH_SCHEMA), so admins sign in with their
 * DocuMind accounts. This app never creates users, never sends email and never migrates the
 * tables (DocuMind owns them; `pnpm auth:check` only compares).
 *
 * Its own secret and cookie prefix: a DocuMind session can't be replayed here, and on localhost
 * (where :3000 and :3100 share cookies) the two apps' sessions don't overwrite each other.
 * Never enable `crossSubDomainCookies` in either app.
 */
function evalSecret(): string | undefined {
  const secret = process.env.EVAL_BETTER_AUTH_SECRET;
  // Better Auth would otherwise fall back to BETTER_AUTH_SECRET, DocuMind's own secret.
  if (!secret && process.env.NEXT_PHASE !== "phase-production-build" && process.env.NODE_ENV === "production") {
    throw new Error("EVAL_BETTER_AUTH_SECRET must be set.");
  }
  return secret;
}

/** Refuses a session for anyone but a platform admin who isn't banned. */
async function assertPlatformAdmin(userId: string) {
  const { rows } = await pool.query<{ role: string | null; banned: boolean | null; banExpires: Date | null }>(
    `select role, banned, "banExpires" from "user" where id = $1`,
    [userId],
  );
  if (!isPlatformAdmin(rows[0])) {
    throw new APIError("FORBIDDEN", { code: NOT_ADMIN_CODE, message: NOT_ADMIN_MESSAGE });
  }
}

export const auth = betterAuth({
  appName: "DocuMind Evaluation",
  database: pool,
  baseURL: process.env.EVAL_BETTER_AUTH_URL,
  secret: evalSecret(),
  trustedOrigins: process.env.EVAL_PUBLIC_URL ? [process.env.EVAL_PUBLIC_URL] : [],
  advanced: { cookiePrefix: "documind-eval" },

  emailAndPassword: {
    enabled: true,
    // Accounts are created (and verified) in DocuMind only.
    disableSignUp: true,
    requireEmailVerification: true,
  },
  // No email from this app: an unverified account is sent back to DocuMind to verify.
  emailVerification: { sendOnSignIn: false },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      disableSignUp: true,
    },
  },

  // The admin plugin's columns, read-only here (no admin endpoints are mounted).
  user: {
    additionalFields: {
      role: { type: "string", required: false, input: false },
      banned: { type: "boolean", required: false, input: false },
      banReason: { type: "string", required: false, input: false },
      banExpires: { type: "date", required: false, input: false },
    },
  },
  // The organization and admin plugins' session columns, so `auth:check` sees DocuMind's schema.
  session: {
    additionalFields: {
      activeOrganizationId: { type: "string", required: false, input: false },
      impersonatedBy: { type: "string", required: false, input: false },
    },
  },

  rateLimit: { enabled: true },

  // DocuMind owns these accounts: only sign-in, the OAuth callback, session reads and sign-out
  // are served here, so this app can't change, verify, reset or delete them.
  disabledPaths: [
    "/sign-up/email",
    "/update-user",
    "/change-email",
    "/change-password",
    "/delete-user",
    "/delete-user/callback",
    "/request-password-reset",
    "/reset-password",
    "/reset-password/:token",
    "/send-verification-email",
    "/verify-email",
    "/verify-password",
    "/link-social",
    "/unlink-account",
    "/list-accounts",
    "/account-info",
    "/get-access-token",
    "/refresh-token",
    "/list-sessions",
    "/revoke-session",
    "/revoke-sessions",
    "/revoke-other-sessions",
    "/update-session",
  ],

  databaseHooks: {
    session: {
      create: {
        // Runs for email and Google sign-in alike; the thrown code reaches the sign-in page
        // (`?error=NOT_PLATFORM_ADMIN` after the Google callback).
        before: async (session) => {
          await assertPlatformAdmin(session.userId);
        },
      },
    },
  },

  plugins: [nextCookies()], // must stay last
});

export type Session = typeof auth.$Infer.Session;
export type SessionUser = Session["user"];
