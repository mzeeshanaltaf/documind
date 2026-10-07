# Phase 6 — App UI (Chat, Citations & PDF Viewer, Documents, Settings, Analytics, Admin)

**Goal:** Build the signed-in product on top of the Phase 2 shell and the Phase 4/5 APIs:
- A BFF proxy to FastAPI.
- Streaming chat with agent chips and clickable citations that open the PDF at the cited page with the passage highlighted.
- Document management with live ingestion progress.
- Org settings (model and service tier), analytics dashboards, and the platform-admin overview.

**Depends on:** Phases 2, 4 and 5. **Unblocks:** Phase 7's polish pass and Phase 8.

## Skills to load
- `/nextjs-best-practices` and `/vercel-react-best-practices`.
- `/impeccable`: use the design context saved in Phase 2. Run its critique/polish on each screen you finish.
- `/shadcn`: components.
- `/pdf-preview`: react-pdf setup and worker config. **Adapt it** to load a URL or ArrayBuffer from the BFF instead of base64.
- `/dataviz`: before writing any chart or KPI tile.
- `/shimmering-progress-dialog` (optional): for the "thinking" state before the first token.

## 1. BFF — `web/src/lib/api.ts` + `web/src/app/api/backend/[...path]/route.ts`
- **`api.ts`** (`import "server-only"`). `apiFetch(path, { userId, method, body, headers, signal })` prefixes `API_BASE_URL/v1` and sets `X-API-Key: DOCUMIND_API_KEY` and `X-User-Id`. Server Components and Actions use it directly.
- **Route handler** for GET, POST, PATCH and DELETE, with `export const runtime = "nodejs"`, `dynamic = "force-dynamic"` and `maxDuration = 300`.
  - **Session.** `auth.api.getSession({ headers })`; no session → 401. FastAPI does the authorization checks; the BFF only proves identity.
  - **Forward the request.** Pass the method, `content-type` and body. For uploads, stream the request body with `duplex: "half"`.
  - **Return the upstream response as-is** with `new Response(upstream.body, { status, headers })`. Pass through `content-type`, `content-disposition` and `cache-control`. **Do not buffer**, because SSE and PDF responses must stream.
  - **Rate limit chat.** For `POST …/chat`, apply an Upstash limit via `@upstash/ratelimit` `Ratelimit.slidingWindow(30, "1 m")` keyed by `chat:${userId}`. Over the limit → 429 with `Retry-After`.
- **Never** expose `DOCUMIND_API_KEY` or `API_BASE_URL` to client code. Neither may have a `NEXT_PUBLIC_` prefix.

## 2. Chat — `web/src/app/(app)/app/[orgSlug]/chat/`
- **Routes.** `page.tsx` is a new chat and `[conversationId]/page.tsx` is an existing one. Server components load the conversation list and messages via `apiFetch`, then render a client `ChatApp` loaded with `next/dynamic({ ssr: false })` (global CLAUDE.md hydration rule).
- **Layout.** The conversation list sits on the left (collapsible; a drawer on mobile) with new chat, rename and delete. The thread is in the centre, and the PDF viewer opens as a right-hand side sheet.
- **`useChatStream` hook** (`web/src/hooks/use-chat-stream.ts`):
  - `fetch("/api/backend/orgs/{orgId}/chat", { method: "POST", body, signal })`, with the SSE parsed by `eventsource-parser`.
  - It handles the `meta`, `routing`, `sources`, `delta`, `citations`, `usage`, `done` and `error` events.
  - A Stop button calls the `AbortController`.
  - After `meta` arrives for a new conversation, the URL updates via `router.replace`.
- **Composer.**
  - Auto-growing textarea; Enter sends, Shift+Enter adds a newline.
  - **Scope picker:** "All documents", or a multi-select of `ready` documents grouped by department (shadcn `Command` in a `Popover`). Each document shows doc_code, title and a jurisdiction badge. The selection is shown as chips and sent as `document_ids`.
  - 429 → toast "Slow down…" with the retry time.
- **Assistant message:**
  - **Agent chips** come from `routing`, e.g. "HR agent · Germany". When the scope bypasses routing, show "Scoped to N documents" instead.
  - **Markdown** via `react-markdown` + `remark-gfm`. Turn `[n]` markers into `<CitationChip n>`. Do this with a small remark plugin that splits text nodes, or by pre-tokenizing; don't use `dangerouslySetInnerHTML`.
  - **`CitationChip`** is a superscript button. Its `HoverCard` shows doc_code · title, `§section_number section_title`, `p.X` and the snippet. Clicking it opens the PDF viewer.
  - **Sources** list under the answer, collapsible: every cited source as a row (doc_code, title, §, page) that also opens the viewer.
  - **Footer** with feedback 👍/👎 (and an optional comment popover), and a muted "1.2s · $0.0004" usage line for admins only.
  - **States.** A shimmer "Searching HR policies…" state between `routing` and the first `delta`. Error state with retry. Empty-state suggestions built from the org catalog, e.g. 4 sample questions per department present.

## 3. PDF viewer with highlight — `web/src/components/pdf/`
- **`PdfViewerSheet`** (client, `ssr:false`) takes `{ documentId, title, page, highlightText }`. It is built on the `/pdf-preview` skill's react-pdf setup.
  - **Load** `/api/backend/orgs/{orgId}/documents/{id}/file`. Pass `file` as a URL; the cookies are same-origin.
  - **Controls:** prev/next page, page input, zoom −/+, fit-width, download, and "Open in new tab".
  - **Open position.** It opens scrolled to `page_start`.
  - **Highlighting** uses the `<Page customTextRenderer>`:
    - Normalize both texts: lowercase, collapse whitespace, unify quotes and dashes.
    - Wrap a text item in `<mark>` when its normalized string (≥ 4 chars) is contained in the normalized `highlightText`.
    - Restrict highlighting to `page_start..page_end`.
    - Scroll the first `<mark>` into view.
  - **Cache.** Keep one loaded `Document` per documentId across citation clicks.

## 4. Documents (admin) — `web/src/app/(app)/app/[orgSlug]/documents/`
- **Table columns:** title, doc_code, department, jurisdiction (with a flag/label), version, effective date, pages, status.
  - **Status** is a badge. A processing document shows `stage` and a progress bar, polled every 2s until it is `ready` or `failed`, using a client island with SWR-style polling.
  - Filter by department and status, plus search.
- **Upload dialog.** A drag-and-drop zone for multiple files (PDF only, ≤ 50MB each, validated on the client), with per-file progress. A 409 duplicate is shown as "Already uploaded". POST is multipart through the BFF.
- **Row actions:** View (opens the viewer at page 1), Edit metadata, Reindex, Delete (confirm dialog).
- **Edit metadata sheet.** A form (zod) with title, doc_code, legal_entity, department (select), jurisdiction (select), doc_type, version, effective_date, owner, approved_by, review_cycle, applies_to and related_doc_codes (tag input).
  - If the response says `needs_reindex`, show a "Reindex now" CTA.
- **Document detail drawer:** summary, outline (ToC with page links into the viewer) and chunk count.
- **Members-only view.** A read-only document list, which lets non-admins browse what they can ask about.

## 5. Settings (admin) — `[orgSlug]/settings`
- **Chat model.** A select over the pricing keys for chat-capable models (`gpt-*`). Show $/1M input, cached and output for the selected tier.
- **Chat service tier.** A radio of Standard / Flex / Auto, with a hint: "Flex ≈ 50% cheaper but slower and may queue; falls back to Standard when unavailable".
- **Background tier.** Used for ingestion, classification and titles; default Flex.
- **Router model and top_k.** Shown in an "Advanced" disclosure.
- **Saving** goes through a Server Action → `PUT /settings`, with a toast.

## 6. Analytics (admin) — `[orgSlug]/analytics` and `/admin/analytics`
- **Range.** 7d, 30d, 90d or custom. `/admin/analytics` adds an org filter.
- **KPI tiles:** total cost, requests (answers), tokens in/out, cache-hit %, p50/p95 latency and TTFT, and 👍 rate.
- **Charts** (Recharts; follow `/dataviz` for colours and tooltips):
  - daily cost as a bar chart,
  - daily tokens as a stacked bar (input-uncached / cached / output),
  - latency p95 as a line.
- **Tables:**
  - by operation (count, tokens, cost),
  - by model × tier,
  - top users,
  - by agent/department,
  - top cited documents.
- **Formatting.** Cost has 4 decimals below $1 and 2 above. Use tabular numerals.

## 7. Platform admin — `/admin`
- **`/admin`:** the orgs overview table (name, slug, docs, members, 30d cost) with a "New organization" button, and links into each org.
- **`/admin/users`:** built in Phase 2; add a column for org memberships.
- **`/admin/analytics`:** see section 6.
- **Guard.** `requireAdmin()` in the `/admin` layout.

## 8. Cross-cutting
- **Loading and errors.** `loading.tsx` skeletons for each route segment, and `error.tsx` boundaries with retry.
- **Responsive.** Down to 360px: the sidebar and conversation list become drawers, and the PDF sheet goes full-screen on mobile.
- **Accessibility.** Focus management in the sheets and dialogs, `aria-live="polite"` on the streaming message, keyboard access for citation chips, and colour contrast that passes AA.
- **Toasts** via `sonner`.

## Acceptance criteria
- [ ] As a member of `simtora`: ask "How much PTO do employees in Germany get?". The answer streams, the HR · Germany chip shows, and the citation chips show hover cards. Clicking one opens SIM-HR-102 at the right page with the passage highlighted.
- [ ] A scoped chat (only the IT Policy Manual) cites only that document.
- [ ] Stop works mid-stream, and refreshing shows the saved conversation and messages.
- [ ] As admin: upload a PDF, watch the stages progress to Ready, edit its metadata, reindex and delete it.
- [ ] As admin: the settings tier change persists. Analytics shows the new requests and cost after a few chats; the flex tier shows a lower cost per request.
- [ ] A member cannot open the documents admin, settings, analytics or `/admin` (server-guarded), and the BFF returns 401 without a session.
- [ ] The 31st chat message within a minute returns 429 and shows a toast.
- [ ] `pnpm typecheck`, `pnpm lint` and `pnpm build` pass. There are no hydration warnings in the console.
- [ ] The `/impeccable` critique has been run on chat, documents and analytics, and its fixes applied.
- [ ] Status.md is updated.
