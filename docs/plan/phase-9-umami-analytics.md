# Phase 9 — Umami Analytics (post-deploy)

**Goal:** Add privacy-first, cookieless page-view analytics and a few product events through the existing self-hosted Umami at `analytics.zeeshanai.cloud`. Analytics loads only in production.

**Depends on:** Phase 8, so DocuMind is live on `documind.zeeshanai.cloud`.

## Skills to load
- `/umami-analytics`: follow it for the Next.js App Router wiring and env gating. The Umami **server already exists**, so skip the server-setup part.

## Known facts
- `.env.local` already has `NEXT_PUBLIC_UMAMI_SCRIPT_URL=https://analytics.zeeshanai.cloud/script.js` and `NEXT_PUBLIC_UMAMI_WEBSITE_ID`.
- **Check the website ID.** In the Umami dashboard (or API), confirm that `NEXT_PUBLIC_UMAMI_WEBSITE_ID` is a website whose domain is `documind.zeeshanai.cloud`.
  - If it belongs to another site, create a "DocuMind" website in Umami and use its ID. Ask the user if you don't have dashboard access.
- **Build-time vars.** These are `NEXT_PUBLIC_*`, so they must be set as **build-time** env in the Coolify `documind-web` app (Phase 8), and the app must be **rebuilt** after any change.

## 1. Tracker wiring
- **Component.** `web/src/components/analytics/umami.tsx` renders `<Script src={SCRIPT_URL} data-website-id={ID} strategy="afterInteractive" />`. It renders only when:
  - both env vars are set, **and**
  - `process.env.NODE_ENV === "production"`.
- **Mount it** in the root `app/layout.tsx`, so it covers the marketing, auth and app pages.
- **Exclude** `/api/*`; it's a script tag, so this happens naturally.
- **Optional:** add `data-domains="documind.zeeshanai.cloud"`, so that local production builds don't send events.

## 2. Product events (`web/src/lib/analytics.ts`)
- **Helper.** A typed `track(event, data?)` that calls `window.umami?.track(...)` and is a no-op when Umami isn't loaded. It's a client-only module.
- **Events.** Never include PII or message content; record only counts and categories.
  - `sign_up_completed`: after OTP verification or the first Google sign-in.
  - `contact_submitted`: on the success state of the contact form.
  - `chat_message_sent`: `{ scoped: boolean }`.
  - `citation_opened`: `{ doc_type?: string }`.
  - `document_uploaded`: admin; `{ count }`.
  - `feedback_given`: `{ value: "up" | "down" }`.
- **CTA tracking.** Use the `data-umami-event` attribute for the landing CTAs (`cta_get_started`, `cta_contact`).

## 3. Privacy policy
- Make sure `/privacy` (Phase 7) mentions Umami: cookieless, aggregated, self-hosted, no personal data. Update it if needed.

## 4. Deploy & verify
- **Commit.** With the user's go-ahead (`/ship`), push to `main`. Auto-deploy rebuilds web.
- **Check the live page:**
  - The page source on `https://documind.zeeshanai.cloud` contains the Umami script tag.
  - The browser network tab shows a `POST …/api/send` to `analytics.zeeshanai.cloud`.
- **Check Umami.** The realtime view shows the visit, and the custom events appear after you exercise them on prod.
- **Check local.** `pnpm dev` loads no Umami script.

## 5. Project wrap-up
- **README.** Final architecture summary, local setup, deployment notes, and the env var reference (names only).
- **Status.md.** Mark all phases Done, and list follow-ups and known limitations, for example:
  - PDF-only uploads;
  - single service API key;
  - admins can't view member chats;
  - the privacy policy needs legal review.

## Acceptance criteria
- [ ] Production page views and custom events are visible in Umami; none come from local dev.
- [ ] No PII in event payloads.
- [ ] The privacy page mentions Umami.
- [ ] README and Status.md are final.
