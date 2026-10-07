import "server-only";
import { Resend } from "resend";

let client: Resend | null = null;

function getClient() {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not set.");
  }
  client ??= new Resend(process.env.RESEND_API_KEY);
  return client;
}

/**
 * RESEND_FROM_EMAIL is used as-is. The only normalisation is stripping
 * surrounding quotes: dotenv removes them locally, but Docker/Coolify pass them
 * through, and Resend then rejects the `from` with a 422.
 */
function fromAddress() {
  const raw = (process.env.RESEND_FROM_EMAIL ?? "").trim();
  const from = raw.replace(/^(['"])([\s\S]*)\1$/, "$2").trim();
  if (!from) throw new Error("RESEND_FROM_EMAIL is not set.");
  return from;
}

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** `<event-type>/<entity-id>`. Omit for sends that must always go out (fresh OTPs). */
  idempotencyKey?: string;
};

/**
 * Sends one transactional email. The SDK resolves with `{ error }` rather than
 * throwing, so errors are logged (never with the message body, which may hold
 * an OTP) and re-thrown for the caller.
 */
export async function sendEmail({ to, subject, html, text, idempotencyKey }: SendEmailInput) {
  const { data, error } = await getClient().emails.send(
    { from: fromAddress(), to: [to], subject, html, text },
    idempotencyKey ? { idempotencyKey } : undefined,
  );
  if (error) {
    console.error(`[email] Resend send failed (${subject}): ${error.name}: ${error.message}`);
    throw new Error(`Resend send failed: ${error.name}`);
  }
  return data;
}
