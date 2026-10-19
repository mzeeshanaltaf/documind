import "server-only";
import type { ApiErrorBody } from "./api-types";

/**
 * Server-side client for the eval API's `/v1` routes. Adds the service key and the acting admin;
 * the eval API authorizes everything again. Server Components and Actions call this directly;
 * the browser goes through the /api/backend proxy, which uses `apiFetch` too.
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
  userId: string;
  method?: string;
  /** A plain object is sent as JSON; anything else (stream, FormData) as-is. */
  body?: unknown;
  headers?: HeadersInit;
  signal?: AbortSignal;
  query?: Query;
};

function apiConfig() {
  const base = process.env.EVAL_API_URL;
  const key = process.env.EVAL_API_KEY;
  if (!base || !key) throw new Error("EVAL_API_URL and EVAL_API_KEY must be set.");
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

/** `path` is relative to `/v1`, e.g. `runs/abc`. Returns the raw response. */
export async function apiFetch(path: string, options: ApiFetchOptions): Promise<Response> {
  const { base, key } = apiConfig();
  const url = new URL(`${base}/v1/${path.replace(/^\/+/, "")}`);
  for (const [name, value] of Object.entries(options.query ?? {})) {
    if (Array.isArray(value)) for (const item of value) url.searchParams.append(name, String(item));
    else if (value !== null && value !== undefined && value !== "") url.searchParams.set(name, String(value));
  }

  const headers = new Headers(options.headers);
  headers.set("X-API-Key", key);
  headers.set("X-User-Id", options.userId);

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
      // Required by Node's fetch for a streamed request body (imports through the proxy).
      ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
    } as RequestInit);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    // A bare "fetch failed" hides the usual cause: the eval API isn't running or the URL is wrong.
    throw new ApiError(503, `The eval API is unreachable at ${base}.`, "api_unreachable", {
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
    body?.error?.message ?? `The eval API answered ${response.status}.`,
    body?.error?.code,
    body?.error?.details,
  );
}

/** JSON helper for Server Components and Actions: throws `ApiError` on a non-2xx answer. */
export async function apiJson<T>(path: string, options: ApiFetchOptions): Promise<T> {
  const response = await apiFetch(path, options);
  if (!response.ok) throw await readApiError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Like `apiJson`, but a 404 becomes null (for `notFound()` in pages). */
export async function apiJsonOrNull<T>(path: string, options: ApiFetchOptions): Promise<T | null> {
  try {
    return await apiJson<T>(path, options);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 422)) return null;
    throw error;
  }
}

/** A Server Action's result: errors come back as data, so the form can show them inline. */
export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string; code?: string };

/** Runs an eval API call for a Server Action and turns an `ApiError` into a readable message. */
export async function action<T>(run: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, error: describeApiError(error), code: error.code };
    throw error;
  }
}

function describeApiError(error: ApiError): string {
  if (error.code === "validation_error" && Array.isArray(error.details)) {
    const first = error.details[0] as { loc?: unknown[]; msg?: string } | undefined;
    if (first?.msg) {
      const field = (first.loc ?? []).filter((part) => part !== "body").join(".");
      return field ? `${field}: ${first.msg}` : first.msg;
    }
  }
  return error.message;
}
