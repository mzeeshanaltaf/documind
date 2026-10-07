# Phase 2 — Design Foundation, Auth & Organizations (web)

**Goal:**
- Establish the DocuMind visual identity.
- Get Better Auth working in the `documind` schema: email+password with OTP verification, password reset via OTP, and Google sign-in, with emails sent through Resend.
- Bootstrap the platform admin from env.
- Let the admin create organizations and add members.

**Depends on:** Phase 1. **Unblocks:** Phase 3, which reads Better Auth's `user`, `member` and `organization` tables.

## Skills to load (in this order)
1. `/impeccable`: the design foundation (section 1).
2. `/better-auth-best-practices`: server and client config.
3. `/better-auth-email-otp`: OTP verification and forgot/reset password with Resend. Follow its gotchas: Resend 422 on `from`, silent sign-in failure, and verified users getting locked out.
4. `/resend`: SDK usage, idempotency, templates.
5. `/nextjs-best-practices` and `/shadcn`: pages and components.

## Tenancy model (decided)
- **Platform admin only.** Only users with `user.role === "admin"` (Better Auth `admin` plugin) can:
  - create organizations,
  - upload and manage documents (Phase 4/6),
  - add or remove members,
  - change settings and view analytics.
- **Normal users** can sign up but only *chat* in the orgs they were added to (role `member`). A user can belong to many orgs.
- **Admins can access every org,** even ones they are not a member of. Both the web guards and FastAPI check `role==='admin' || membership exists`.
- **Bootstrap.** Any email in `PLATFORM_ADMIN_EMAILS` (comma-separated, compared case-insensitively) becomes admin. The admin can promote or demote others in `/admin/users`.

## 1. Design foundation (`/impeccable`)
- **Brand.** "DocuMind", tagline "Turn company documents into an intelligent assistant". The audience is HR, Ops and Compliance teams, and the tone is trustworthy, calm and precise.
- **Tokens.** Define colors, type scale, radius and spacing as CSS variables in `web/src/app/globals.css` (Tailwind v4 `@theme`), for both light and dark mode. Pick fonts via `next/font`.
- **Persist the context.** Save the design context to the file impeccable creates (e.g. `web/DESIGN.md` or `.impeccable.md`), so later phases (6, 7) reuse the same system. Mention its path in CLAUDE.md.
- **Logo.** Build a simple SVG wordmark/logo component in `web/src/components/brand/logo.tsx`.

## 2. Database & schema
- **`web/src/lib/db.ts`** exports a `pg` `Pool` built from `DATABASE_URL`:
  - Parse it with `URL` and read `schema`, defaulting to `documind`.
  - Delete the `schema`, `connection_limit` and `pool_timeout` params.
  - Pass `options: "-c search_path=<schema>,public"` and `max: 5`, because the DB is shared.
  - Export `DB_SCHEMA`.
- **Create the schema once:** `web/scripts/create-schema.ts`, run with `pnpm tsx`, executes `CREATE SCHEMA IF NOT EXISTS <schema>`.
- **Better Auth tables.** Create them with `pnpm dlx @better-auth/cli@latest migrate` (or `generate` + apply).
  - **Verify the tables landed in `<schema>` and not in `public`:**
    `select table_schema, table_name from information_schema.tables where table_name in ('user','session','account','verification','organization','member','invitation')`.
  - If the CLI ignores `search_path`, apply the generated SQL manually with `SET search_path`.
- **Column naming.** Better Auth uses **camelCase quoted columns** (`"emailVerified"`, `"organizationId"`, `"userId"`, `"createdAt"`) and the table name `"user"`, which must be quoted. Record the exact column list in Status.md for Phase 3.

## 3. `web/src/lib/auth.ts` (server)
- **Database:** `database: pool`, the Pool from `db.ts`.
- **Base config:** `baseURL: BETTER_AUTH_URL`, `secret: BETTER_AUTH_SECRET`, and `trustedOrigins` set to the app URL. Phase 8 adds the prod URL.
- **`emailAndPassword`:** `{ enabled: true, requireEmailVerification: true, minPasswordLength: 8 }`.
- **`socialProviders.google`:** `{ clientId, clientSecret }`. Google accounts arrive already verified.
- **Plugins** (`nextCookies()` must be last):
  - `emailOTP({ otpLength: 6, expiresIn: 600, sendVerificationOnSignUp: true, overrideDefaultEmailVerification: true, sendVerificationOTP: ({email, otp, type}) => sendOtpEmail(...) })`. It handles the types `email-verification`, `sign-in` and `forget-password`.
  - `organization({ allowUserToCreateOrganization: async (user) => user.role === "admin", sendInvitationEmail: (data) => sendInvitationEmail(...) })`.
  - `admin()`, which supplies the user role, ban and impersonation features.
  - `nextCookies()`.
- **`databaseHooks.user.create.before`:** if the lowercased email is in `PLATFORM_ADMIN_EMAILS`, set `role: "admin"`.
- **Login hook for existing users:** also add `databaseHooks.session.create.after`. If the user's email is in the list and their role isn't `admin`, update it. This covers a user who signed up before the env was set.
- **Rate limiting:** enable Better Auth's built-in `rateLimit` with defaults.
- **Route handler:** `web/src/app/api/auth/[...all]/route.ts` uses `toNextJsHandler(auth)`.
- **Client:** `web/src/lib/auth-client.ts` exports `createAuthClient` with `emailOTPClient()`, `organizationClient()` and `adminClient()`.

## 4. Emails (`web/src/lib/email/`)
- **`resend.ts`:** a Resend client plus a `sendEmail({to, subject, react|html, idempotencyKey})` helper. It uses `RESEND_FROM_EMAIL` as-is, without reformatting it. Follow the `/resend` skill for idempotency keys.
- **Templates** in React Email style or plain HTML, matching the brand:
  - `OtpEmail`: subject and copy vary by `type`.
  - `InvitationEmail`: names the org and inviter, and links to `${APP_URL}/accept-invitation/${id}`.
- **Logging.** Log Resend errors server-side, and never log OTP values.

## 5. Auth pages — route group `web/src/app/(auth)/`
- **Pages:**
  - `sign-in`: email+password, a "Continue with Google" button, and links to sign-up and forgot-password.
  - `sign-up`: name, email and password, then redirect to `verify-email?email=`.
  - `verify-email`: a 6-digit OTP input, resend with cooldown, and auto sign-in after success per the skill.
  - `forgot-password`: request an OTP of type `forget-password`.
  - `reset-password`: OTP plus new password.
  - `accept-invitation/[id]`: the user must be signed in with the invited email; on accept, redirect to `/app/<orgSlug>/chat`.
- **Behaviour:**
  - Every form has visible error states and loading states.
  - Unverified sign-in attempts route to `verify-email`.
  - Follow the global CLAUDE.md hydration rule: any client tree using browser-only values at init loads via `next/dynamic` with `ssr:false`.

## 6. Guards & routing
- **`web/src/proxy.ts`** (Next 16 middleware). Use `getSessionCookie()` for optimistic redirects:
  - `/app/**` and `/admin/**` without a cookie go to `/sign-in?next=…`.
  - Signed-in users hitting the auth pages go to `/app`.
- **`web/src/lib/auth-guards.ts`** (server-only):
  - `requireSession()`
  - `requireAdmin()`
  - `requireOrgAccess(orgSlug)`, which returns `{ user, org, role, isAdmin }` and calls `notFound()` or `redirect()` on failure.
  - These are used by the layouts and, in Phase 6, by the BFF.
- **`listAccessibleOrgs(user)`.** Admins get all orgs via a direct SQL query on `organization`; members get `auth.api.listOrganizations`.

## 7. App shell & org pages — `web/src/app/(app)/`
- **`/app`.** If the user has no orgs, show an empty state ("You haven't been added to an organization yet — ask your administrator"). Otherwise redirect to the last active org (`session.activeOrganizationId`) or the first one.
- **`/app/[orgSlug]/layout.tsx`.** The app shell has:
  - a sidebar with the org switcher (a `Command` popover), nav (Chat, Documents*, Members*, Settings*, Analytics*), and the user menu with sign-out. Items marked * are admin-only.
  - a placeholder `chat` page for now.
- **`/app/new-org`** (admin only). Takes a name and an auto-slugified, editable slug, and calls `authClient.organization.create`. The admin becomes owner.
- **`/app/[orgSlug]/members`** (admin only):
  - **Member list:** a table of members showing email, name, role and joined date, with a remove action.
  - **Adding by email:**
    - If a user with that email exists, add them directly with server-side `auth.api.addMember({ body: { userId, organizationId, role: "member" } })`.
    - Otherwise call `auth.api.createInvitation`, which sends the email via the hook.
  - **Pending invitations:** listed with resend and cancel actions.
- **`/admin/users`** (admin only). A users table with search, plus promote/demote admin and ban/unban through the admin plugin APIs.
- **Server Actions.** Use Server Actions for mutations, each re-checking `requireAdmin()`.

## Acceptance criteria
- [ ] Better Auth tables exist in the configured schema, not in `public`.
- [ ] Sign-up sends an OTP email via Resend; verifying it signs the user in and lands on the empty state.
- [ ] Sign-in with Google works on localhost. The Google console needs `http://localhost:3000/api/auth/callback/google`; ask the user to add it if it's missing.
- [ ] Forgot password → OTP → reset → sign in with the new password works.
- [ ] An email listed in `PLATFORM_ADMIN_EMAILS` gets `role=admin`, both on sign-up and on login for an existing user.
- [ ] The admin can create org "Simtora Technologies" (slug `simtora`) and add an existing user directly.
- [ ] An invite to an unknown email arrives, and after sign-up the invitation can be accepted.
- [ ] A non-admin cannot reach `/app/new-org`, `/members` or `/admin/*` (redirect or 404); this is checked server-side, not just hidden in the UI.
- [ ] `pnpm typecheck`, `pnpm lint` and `pnpm build` pass.
- [ ] Status.md updated, including the Better Auth table and column names.
