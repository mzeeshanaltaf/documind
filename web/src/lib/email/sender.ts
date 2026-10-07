import "server-only";

/** The bare address from RESEND_FROM_EMAIL ("DocuMind <a@b.c>" -> "a@b.c"), for UI copy. */
export function senderAddress(): string | null {
  const raw = (process.env.RESEND_FROM_EMAIL ?? "").trim().replace(/^(['"])([\s\S]*)\1$/, "$2");
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).trim() || null;
}
