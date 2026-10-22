import { isBanned } from "@/lib/account";
import { apiFetch } from "@/lib/api";
import { auth } from "@/lib/auth";
import { CHAT_PATH, upstreamPath } from "@/lib/backend-path";
import { limitChat } from "@/lib/rate-limit";

/**
 * BFF proxy: browser → /api/backend/<path> → DocuMind FastAPI /v1/<path>.
 * Proves identity only (Better Auth session → X-User-Id); FastAPI authorizes, so any signed-in,
 * non-banned user may call it. Request and response bodies are streamed, never buffered (chat
 * SSE, PDFs). Chat POSTs share DocuMind's own rate-limit window.
 * Runs on Node.js (the default; `runtime` itself is rejected under cacheComponents).
 */
export const maxDuration = 300;

// Keep this list minimal: FastAPI's admin-only eval hooks key off X-Eval-Run-Id / X-Eval-Case-Id
// (hidden conversations, no quota, overrides), so a browser must never be able to forward them.
const FORWARD_REQUEST_HEADERS = ["content-type", "accept"];
const FORWARD_RESPONSE_HEADERS = [
  "content-type",
  "content-disposition",
  "content-length",
  "accept-ranges",
  "cache-control",
  "retry-after",
  "x-request-id",
];

function json(status: number, code: string, message: string, headers?: HeadersInit) {
  return Response.json({ error: { code, message } }, { status, headers });
}

async function proxy(request: Request, ctx: RouteContext<"/api/backend/[...path]">) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return json(401, "unauthorized", "Sign in to continue.");
  if (isBanned(session.user.banned, session.user.banExpires)) {
    return json(403, "forbidden", "This account is suspended.");
  }

  const path = upstreamPath((await ctx.params).path);
  if (!path) return json(400, "bad_path", "Invalid path.");
  const method = request.method;

  if (method === "POST" && CHAT_PATH.test(path)) {
    const limit = await limitChat(session.user.id);
    if (!limit.ok) {
      // The same copy as DocuMind's BFF (web/src/app/api/backend/[...path]/route.ts).
      return json(
        429,
        "rate_limited",
        `Slow down: too many questions in a minute. Try again in ${limit.retryAfterSeconds}s.`,
        { "Retry-After": String(limit.retryAfterSeconds) },
      );
    }
  }

  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const hasBody = method !== "GET" && method !== "HEAD" && request.body !== null;

  const search = new URL(request.url).searchParams;
  const query: Record<string, string[]> = {};
  for (const key of new Set(search.keys())) query[key] = search.getAll(key);

  let upstream: Response;
  try {
    upstream = await apiFetch(path, {
      userId: session.user.id,
      method,
      headers,
      body: hasBody ? request.body : undefined,
      query,
      // A closed tab or a Stop aborts upstream too, so FastAPI saves the answer as stopped.
      signal: request.signal,
    });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.error("BFF upstream request failed", error);
    return json(502, "upstream_unavailable", "The DocuMind API is unreachable. Try again shortly.");
  }

  const responseHeaders = new Headers();
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  // fetch() decodes a compressed body, so the upstream length would no longer match it.
  if (upstream.headers.has("content-encoding")) responseHeaders.delete("content-length");
  if (upstream.headers.get("content-type")?.startsWith("text/event-stream")) {
    // no-transform keeps Next's response compression from buffering the stream.
    responseHeaders.set("Cache-Control", "no-cache, no-transform");
    responseHeaders.set("X-Accel-Buffering", "no");
  }

  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
