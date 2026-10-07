import { apiFetch } from "@/lib/api";
import { auth } from "@/lib/auth";
import { limitChat } from "@/lib/rate-limit";

/**
 * BFF proxy: browser → /api/backend/<path> → FastAPI /v1/<path>.
 * Proves identity only (Better Auth session → X-User-Id); FastAPI authorizes.
 * Request and response bodies are streamed, never buffered (uploads, SSE, PDFs).
 * Runs on Node.js (the default; `runtime` itself is rejected under cacheComponents).
 */
export const maxDuration = 300;

const FORWARD_REQUEST_HEADERS = ["content-type", "accept"];
const FORWARD_RESPONSE_HEADERS = ["content-type", "content-disposition", "cache-control", "retry-after", "x-request-id"];
const CHAT_PATH = /^orgs\/[^/]+\/chat$/;

function json(status: number, code: string, message: string, headers?: HeadersInit) {
  return Response.json({ error: { code, message } }, { status, headers });
}

async function proxy(request: Request, ctx: RouteContext<"/api/backend/[...path]">) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return json(401, "unauthorized", "Sign in to continue.");

  const { path: segments } = await ctx.params;
  // Next decodes segments; re-encode each and refuse dot segments so a path can't escape /v1.
  if (segments.some((s) => s === "." || s === ".." || s === "")) {
    return json(400, "bad_path", "Invalid path.");
  }
  const path = segments.map(encodeURIComponent).join("/");
  const method = request.method;

  if (method === "POST" && CHAT_PATH.test(path)) {
    const limit = await limitChat(session.user.id);
    if (!limit.ok) {
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

  let upstream: Response;
  try {
    upstream = await apiFetch(path, {
      userId: session.user.id,
      method,
      headers,
      body: hasBody ? request.body : undefined,
      query: Object.fromEntries(new URL(request.url).searchParams),
      // A closed tab or the Stop button aborts upstream too, so FastAPI saves the answer as stopped.
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
  if (upstream.headers.get("content-type")?.startsWith("text/event-stream")) {
    // no-transform keeps Next's response compression from buffering the stream.
    responseHeaders.set("Cache-Control", "no-cache, no-transform");
    responseHeaders.set("X-Accel-Buffering", "no");
  }

  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
