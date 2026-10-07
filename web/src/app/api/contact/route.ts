import { NextResponse, type NextRequest } from "next/server";
import { CONTACT_ERRORS, contactIssueCode, contactSchema, type ContactErrorCode } from "@/lib/contact";
import { limitContact } from "@/lib/rate-limit";

/**
 * Contact form → n8n webhook. Accepts JSON (the hydrated form's fetch) and
 * url-encoded/multipart bodies (the native POST when JavaScript is off or React
 * didn't hydrate). Native posts get 303 redirects back to /contact.
 */

type Body = { name: string; email: string; message: string; hpField: string };

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function parseBody(request: NextRequest): Promise<Body> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
    const form = await request.formData();
    return {
      name: text(form.get("name")),
      email: text(form.get("email")),
      message: text(form.get("message")),
      hpField: text(form.get("hp_field")),
    };
  }
  const json = (await request.json()) as Record<string, unknown>;
  return { name: text(json.name), email: text(json.email), message: text(json.message), hpField: text(json.hp_field) };
}

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "anonymous";
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  const isFormPost = !contentType.includes("application/json");

  const ok = () =>
    isFormPost ? NextResponse.redirect(new URL("/contact?sent=1", request.url), 303) : NextResponse.json({ success: true });

  const fail = (code: ContactErrorCode, status: number, headers?: HeadersInit) =>
    isFormPost
      ? NextResponse.redirect(new URL(`/contact?error=${code}`, request.url), { status: 303, headers })
      : NextResponse.json({ success: false, code, message: CONTACT_ERRORS[code] }, { status, headers });

  let body: Body;
  try {
    body = await parseBody(request);
  } catch {
    return fail("parse", 400);
  }

  // Honeypot filled: report success so a bot gets nothing to adapt to.
  if (body.hpField.trim()) return ok();

  const parsed = contactSchema.safeParse(body);
  if (!parsed.success) return fail(contactIssueCode(parsed.error), 400);

  const limit = await limitContact(clientIp(request));
  if (!limit.ok) return fail("rate", 429, { "Retry-After": String(limit.retryAfterSeconds) });

  const webhookUrl = process.env.N8N_CONTACT_WEBHOOK_URL;
  const apiKey = process.env.N8N_API_KEY;
  if (!webhookUrl || !apiKey) {
    console.error("[contact] N8N_CONTACT_WEBHOOK_URL or N8N_API_KEY is not set");
    return fail("server", 500);
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ ...parsed.data, source: "documind", submittedAt: new Date().toISOString() }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.error(`[contact] Webhook returned ${response.status}`);
      return fail("server", 502);
    }
  } catch (error) {
    console.error("[contact] Webhook request failed", error);
    return fail("server", 502);
  }

  return ok();
}
