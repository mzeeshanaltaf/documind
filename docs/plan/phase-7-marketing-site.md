# Phase 7 — Marketing Site (Landing, Contact, Privacy) & Design Polish

**Goal:** Build a distinctive public marketing site:
- a landing page;
- a Contact Us page posting to n8n, with an Upstash rate limit and a honeypot;
- a Privacy Policy page;
- SEO basics.

Finish with an `/impeccable` audit and polish pass across the whole app.

**Depends on:** Phase 2 (design tokens). The landing page is richer once Phase 6 exists, because it can mirror the real chat UI. **Unblocks:** Phase 8.

## Skills to load
- `/impeccable`: the design work for every page here, then `audit` and `polish` across the app at the end.
- `/nextjs-contact-form`: scaffolds `/contact` completely. **Follow it as written:** n8n webhook with the `x-api-key` header, a non-descriptive honeypot, an Upstash per-IP limit, and progressive enhancement.
  - Its env vars already exist: `N8N_CONTACT_WEBHOOK_URL`, `N8N_API_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.
- `/nextjs-best-practices`. `/seo-audit` is optional, for a final check.

## 1. Route group `web/src/app/(marketing)/`
- **`layout.tsx`.**
  - **Header:** logo; nav anchors (Features, How it works, Security, FAQ); Contact; and Sign in / Get started. If the user is signed in, show "Open app" instead. Use a server check of the session cookie only, to avoid a DB hit on every marketing page.
  - **Footer:** tagline, Privacy, Contact, and © year.
  - **Mobile:** a menu sheet.
- **Pages are static,** with no client-only state. Keep JS minimal; the contact form is a progressive-enhancement island.

## 2. Landing page `/`
- **Messaging.** Product name **DocuMind**, tagline **"Turn company documents into an intelligent assistant"**.
- **Audience.** People Ops, HR, IT, Finance and Compliance leaders at multi-entity companies.
- **Sections** (adjust the composition with `/impeccable`; avoid a generic template look):
  1. **Hero.**
     - Copy: the tagline, a one-line value prop ("Employees ask in plain language. DocuMind answers from your policies — with citations that open the exact page."), and the CTAs Get started → `/sign-up` and Talk to us → `/contact`.
     - **Product visual built in HTML/CSS, not a screenshot:** a mini chat with an "HR · Germany" agent chip, an answer with `[1]` citation chips, and a PDF page card with a highlighted passage. It should reuse the real chat components' styles where practical.
  2. **Problem → outcome.** Policy PDFs nobody reads; repeated HR tickets; country-specific rules.
  3. **How it works** (3 steps): Upload policies → DocuMind indexes them (metadata, sections, pages) → Ask and get cited answers.
  4. **Features grid:**
     - citations that open the exact PDF page;
     - hybrid search (keyword BM25 + semantic) that finds both "SIM-PRC-001" and "can I expense my internet?";
     - departmental agents (HR, IT, Finance, Facilities…) with country awareness;
     - multiple organizations;
     - usage and cost analytics with model service-tier control;
     - Google or email sign-in.
  5. **Security & privacy:** private storage, role-based access, data used only to answer your questions, self-hosted infrastructure. Keep the claims accurate; no certifications we don't have.
  6. **FAQ:** 5–6 items in an accordion, e.g. which file types (PDF today), how answers are grounded, what happens when the answer isn't in the documents, who can upload, where the data is stored.
  7. **Final CTA band.**
- **Motion.** Subtle, and respecting `prefers-reduced-motion`.

## 3. Contact `/contact`
- Generate it with `/nextjs-contact-form` and restyle it with the brand tokens. Fields: Name, Email, Message (plus anything the skill adds).
- **Verify:** a submit reaches the n8n webhook, the honeypot silently drops bots, and the N+1th submit from the same IP is rate-limited with a friendly message. The form must still work with JS disabled.

## 4. Privacy Policy `/privacy`
- **Format.** A static, readable long-form page with a table of contents, an "Effective date" (the build date as a constant, editable) and a contact email/link to `/contact`.
- **Cover these topics accurately**, matching what the app really does:
  - **Who we are:** DocuMind, operated by the site owner.
  - **Data we collect:**
    - account data (name, email, Google profile basics if Google sign-in is used);
    - authentication data (sessions, hashed passwords, one-time codes);
    - organization membership;
    - uploaded documents and derived data (text chunks, embeddings, metadata);
    - chat messages and feedback;
    - usage metrics (token counts, latency, cost);
    - contact-form submissions;
    - cookieless, aggregated web analytics (Umami).
  - **How we use it:** providing the service, answering questions from your org's documents, security and abuse prevention (rate limiting), support, service improvement.
  - **Processors / third parties:**
    - OpenAI (generating answers and embeddings);
    - Resend (transactional email);
    - Google (OAuth sign-in);
    - Upstash (rate limiting);
    - n8n (contact-form handling);
    - Hostinger VPS (hosting, database and file storage);
    - Umami (self-hosted analytics).
  - **Retention:** while the account/org exists; deletion on request; documents are deleted from storage when removed by an admin.
  - **Security** measures; **your rights** (access, correction, deletion, objection); international transfers; children; changes to the policy; contact.
- **Add a visible note** in the Status.md handoff (not on the page) that the owner should review the policy legally before launch.

## 5. SEO & metadata
- **Metadata.** Root `metadata` with title template `%s · DocuMind`, a description built from the tagline, `metadataBase` = `NEXT_PUBLIC_APP_URL`, Open Graph and Twitter cards.
- **Social image.** `app/opengraph-image.tsx` uses `next/og` to render the brand wordmark and tagline.
- **Crawling.**
  - `app/sitemap.ts` lists `/`, `/contact`, `/privacy`, `/sign-in` and `/sign-up`.
  - `app/robots.ts` disallows `/app`, `/admin` and `/api`.
- **Favicon/icon** from the logo.

## 6. Whole-app design pass
- **Audit.** Run the `/impeccable` audit over the marketing pages, the auth pages and the app screens (chat, documents, settings, analytics, admin).
- **Fix** typography rhythm, spacing, empty, loading and error states, focus states, dark mode, contrast and responsive issues.
- **Record** the notable decisions in the design context file.

## Acceptance criteria
- [ ] `/`, `/contact` and `/privacy` render well at 360px, 768px and 1280px, in light and dark mode.
- [ ] A contact submission reaches n8n; the rate limit and honeypot are verified; the form works with JS disabled.
- [ ] Lighthouse on `/` (prod build, `pnpm build && pnpm start`) scores ≥ 90 for Performance, Accessibility, Best Practices and SEO.
- [ ] Sitemap and robots are served; OG image renders at `/opengraph-image`.
- [ ] The impeccable audit findings are fixed or consciously deferred (noted in Status.md).
- [ ] `pnpm typecheck`, `pnpm lint` and `pnpm build` pass.
- [ ] Status.md is updated, including the "owner to legally review privacy policy" note.
