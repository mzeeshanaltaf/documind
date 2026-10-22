import "server-only";
import type { ApiErrorBody } from "./api-types";
import { requireSession } from "./auth-guards";

/**
 * Server-side client for DocuMind's FastAPI `/v1` routes (copied from evaluation/web's
 * eval-api.ts). Adds the service key and the acting user; FastAPI authorizes everything again.
 * Server Components and Actions call this directly; the browser goes through the /api/backend
 * proxy, which uses `apiFetch` too.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Query = Record<string, string | number | boolean | null | undefined | Array<string | number>>;

type ApiFetchOptions = {
  /** The acting user. Server Components may omit it: the current session's user is used. */
  userId?: string;
  method?: string;
  /** A plain object is sent as JSON; anything else (stream, FormData) as-is. */
  body?: unknown;
  headers?: HeadersInit;
  signal?: AbortSignal;
  query?: Query;
};

function apiConfig() {
  const base = process.env.API_BASE_URL;
  const key = process.env.DOCUMIND_API_KEY;
  if (!base || !key) throw new Error("API_BASE_URL and DOCUMIND_API_KEY must be set.");
  return { base: base.replace(/\/+$/, ""), key };
}

function isRawBody(body: unknown): body is BodyInit {
  return (
    typeof body === "string" ||
    body instanceof ReadableStream ||
    body instanceof FormData ||
    body instanceof Blob ||
    body instanceof ArrayBuffer ||
    body instanceof URLSearchParams
  );
}

/** `path` is relative to `/v1`, e.g. `orgs/abc/documents`. Returns the raw response. */
export async function apiFetch(path: string, options: ApiFetchOptions = {}): Promise<Response> {
  const { base, key } = apiConfig();
  const userId = options.userId ?? (await requireSession()).user.id;
  const url = new URL(`${base}/v1/${path.replace(/^\/+/, "")}`);
  for (const [name, value] of Object.entries(options.query ?? {})) {
    if (Array.isArray(value)) for (const item of value) url.searchParams.append(name, String(item));
    else if (value !== null && value !== undefined && value !== "") url.searchParams.set(name, String(value));
  }

  const headers = new Headers(options.headers);
  headers.set("X-API-Key", key);
  headers.set("X-User-Id", userId);

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    if (isRawBody(options.body)) {
      body = options.body;
    } else {
      body = JSON.stringify(options.body);
      headers.set("Content-Type", "application/json");
    }
  }

  try {
    return await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body,
      signal: options.signal,
      cache: "no-store",
      // Required by Node's fetch for a streamed request body (chat POSTs through the proxy).
      ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
    } as RequestInit);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    // A bare "fetch failed" hides the usual cause: FastAPI isn't running or API_BASE_URL is wrong.
    throw new ApiError(503, `The DocuMind API is unreachable at ${base}.`, "api_unreachable", {
      cause: error instanceof Error ? (error.cause ?? error.message) : String(error),
    });
  }
}

export async function readApiError(response: Response): Promise<ApiError> {
  let body: ApiErrorBody | undefined;
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    // Not JSON (a proxy error page, an empty 502).
  }
  return new ApiError(
    response.status,
    body?.error?.message ?? `The DocuMind API answered ${response.status}.`,
    body?.error?.code,
    body?.error?.details,
  );
}

/** JSON helper for Server Components and Actions: throws `ApiError` on a non-2xx answer. */
export async function apiJson<T>(path: string, options?: ApiFetchOptions): Promise<T> {
  const response = await apiFetch(path, options);
  if (!response.ok) throw await readApiError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
