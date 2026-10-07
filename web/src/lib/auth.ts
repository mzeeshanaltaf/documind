import "server-only";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins/admin";
import { emailOTP } from "better-auth/plugins/email-otp";
import { organization } from "better-auth/plugins/organization";
import { pool } from "./db";
import { appUrl, sendInvitationEmail } from "./email/invitation-email";
import { OTP_EXPIRY_MINUTES, sendOtpEmail } from "./email/otp-email";
import { RESERVED_SLUGS, SLUG_PATTERN } from "./slug";

/** Lower-cased emails from PLATFORM_ADMIN_EMAILS (comma-separated). */
export function platformAdminEmails(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function isPlatformAdminEmail(email: string | null | undefined) {
  return !!email && platformAdminEmails().includes(email.toLowerCase());
}

export const auth = betterAuth({
  appName: "DocuMind",
  database: pool,
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  // Phase 8 adds the production origin.
  trustedOrigins: [appUrl()],

  emailAndPassword: {
    enabled: true,
    // Sign-up creates the account but no session until the emailed code is entered.
    requireEmailVerification: true,
    minPasswordLength: 8,
  },
  emailVerification: {
    // An unverified sign-in attempt gets a fresh code, so the verify screen always has one waiting.
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    },
  },

  rateLimit: { enabled: true },

  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (isPlatformAdminEmail(user.email)) {
            return { data: { ...user, role: "admin" } };
          }
        },
      },
    },
    session: {
      create: {
        // Promotes a listed email that signed up before PLATFORM_ADMIN_EMAILS included it.
        after: async (session) => {
          const admins = platformAdminEmails();
          if (admins.length === 0) return;
          await pool.query(
            `update "user" set role = 'admin', "updatedAt" = now()
              where id = $1 and lower(email) = any($2::text[]) and role is distinct from 'admin'`,
            [session.userId, admins],
          );
        },
      },
    },
  },

  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: OTP_EXPIRY_MINUTES * 60,
      allowedAttempts: 5,
      storeOTP: "hashed",
      // Codes replace link-based verification. Core sends on sign-up/sign-in, so
      // the plugin's own sendVerificationOnSignUp is left off (it would be ignored).
      overrideDefaultEmailVerification: true,
      // Stops /sign-in/email-otp from creating nameless, passwordless accounts.
      disableSignUp: true,
      sendVerificationOTP: async ({ email, otp, type }) => {
        // Only the flows the UI exposes; an unused endpoint can't quietly mail users.
        if (type !== "email-verification" && type !== "forget-password") return;
        await sendOtpEmail(email, otp, type);
      },
    }),
    organization({
      allowUserToCreateOrganization: async (user) => user.role === "admin",
      organizationHooks: {
        beforeCreateOrganization: async ({ organization }) => {
          const slug = organization.slug ?? "";
          if (!SLUG_PATTERN.test(slug) || RESERVED_SLUGS.has(slug)) {
            throw new APIError("BAD_REQUEST", { message: "That organization address isn't allowed. Pick another." });
          }
        },
      },
      sendInvitationEmail: async ({ id, email, organization, inviter, invitation }) => {
        await sendInvitationEmail({
          invitationId: id,
          email,
          organizationName: organization.name,
          inviterName: inviter.user.name,
          inviterEmail: inviter.user.email,
          expiresAt: new Date(invitation.expiresAt),
        });
      },
    }),
    admin(),
    nextCookies(), // must stay last
  ],
});

export type Session = typeof auth.$Infer.Session;
export type SessionUser = Session["user"];
