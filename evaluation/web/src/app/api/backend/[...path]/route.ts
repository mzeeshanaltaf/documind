import { isPlatformAdmin } from "@/lib/admin";
import { auth } from "@/lib/auth";
import { apiFetch } from "@/lib/eval-api";

/**
 * BFF proxy: browser → /api/backend/<path> → eval API /v1/<path>.
 * Checks the Better Auth session and the platform-admin role (403 otherwise); the eval API
 * authorizes again from X-User-Id. Request and response bodies are streamed, never buffered
 * (imports, exports, the run's SSE progress).
 * Runs on Node.js (the default; `runtime` itself is rejected under cacheComponents).
 */
export const maxDuration = 300;

const FORWARD_REQUEST_HEADERS = ["content-type", "accept"];
const FORWARD_RESPONSE_HEADERS = ["content-type", "content-disposition", "cache-control", "x-request-id"];

function json(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

async function proxy(request: Request, ctx: RouteContext<"/api/backend/[...path]">) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return json(401, "unauthorized", "Sign in to continue.");
  if (!isPlatformAdmin(session.user)) return json(403, "forbidden", "Only DocuMind platform admins can use Evaluation.");

  const { path: segments } = await ctx.params;
  // Next decodes segments; re-encode each and refuse dot segments so a path can't escape /v1.
  if (segments.some((s) => s === "." || s === ".." || s === "")) {
    return json(400, "bad_path", "Invalid path.");
  }
  const path = segments.map(encodeURIComponent).join("/");
  const method = request.method;

  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  // EventSource reconnects resume after the last case seen.
  const lastEventId = request.headers.get("last-event-id");
  if (lastEventId) headers.set("Last-Event-ID", lastEventId);
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
      signal: request.signal,
    });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.error("BFF upstream request failed", error);
    return json(502, "upstream_unavailable", "The eval API is unreachable. Try again shortly.");
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
