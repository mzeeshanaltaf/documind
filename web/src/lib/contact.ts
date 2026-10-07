import { z } from "zod";

export const MESSAGE_MAX = 5000;

/** Error codes the contact route sends back (`/contact?error=<code>` for native posts). */
export const CONTACT_ERRORS = {
  fields: "Fill in your name, email and message.",
  email: "That email address doesn't look right. Check it and send again.",
  length: `Keep the message under ${MESSAGE_MAX.toLocaleString("en-US")} characters.`,
  rate: "You've sent several messages in a short time. Wait about 10 minutes, then try again.",
  server: "We couldn't send your message just now. Try again in a few minutes.",
  parse: "We couldn't read that submission. Reload the page and try again.",
} as const;

export type ContactErrorCode = keyof typeof CONTACT_ERRORS;

export function contactErrorMessage(code: string | undefined): string | undefined {
  if (!code) return undefined;
  return code in CONTACT_ERRORS ? CONTACT_ERRORS[code as ContactErrorCode] : CONTACT_ERRORS.server;
}

export const contactSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().min(1).max(320).pipe(z.email()),
  message: z.string().trim().min(1).max(MESSAGE_MAX),
});

export type ContactInput = z.infer<typeof contactSchema>;

/** Maps the first schema issue to a route error code. */
export function contactIssueCode(error: z.ZodError): ContactErrorCode {
  const issue = error.issues[0];
  if (issue?.code === "too_small") return "fields";
  if (issue?.path[0] === "email") return "email";
  if (issue?.path[0] === "message") return "length";
  return "fields";
}
