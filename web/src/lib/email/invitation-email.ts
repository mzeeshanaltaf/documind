import "server-only";
import { EMAIL_COLORS as c, emailLayout, escapeHtml } from "./layout";
import { sendEmail } from "./resend";

export function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(
    /\/$/,
    "",
  );
}

export type InvitationEmailInput = {
  invitationId: string;
  email: string;
  organizationName: string;
  inviterName: string;
  inviterEmail: string;
  expiresAt: Date;
};

export function invitationEmailContent({ invitationId, organizationName, inviterName, inviterEmail }: InvitationEmailInput) {
  const url = `${appUrl()}/accept-invitation/${invitationId}`;
  const org = escapeHtml(organizationName);
  const inviter = escapeHtml(inviterName || inviterEmail);
  const subject = `${inviterName || inviterEmail} invited you to ${organizationName} on DocuMind`;
  const heading = `Join ${org} on DocuMind`;
  const body = `
    <p style="margin:0;">${inviter} (${escapeHtml(inviterEmail)}) invited you to join <strong style="color:${c.ink};">${org}</strong>.
    You'll be able to ask questions about its policy documents and see the exact page each answer comes from.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:22px;"><tr>
      <td style="background-color:${c.primary};border-radius:8px;">
        <a href="${url}" style="display:inline-block;padding:11px 20px;font-size:14px;font-weight:600;color:${c.primaryText};text-decoration:none;">Accept invitation</a>
      </td>
    </tr></table>
    <p style="margin:16px 0 0 0;font-size:13px;">Sign in or create an account with this email address to accept. The invitation expires in 48 hours.</p>
    <p style="margin:12px 0 0 0;font-size:12px;word-break:break-all;">Or paste this link into your browser: ${url}</p>`;
  const html = emailLayout({
    preheader: `${inviter} invited you to ${org}`,
    heading,
    body,
    footer: "If you weren't expecting this invitation, you can ignore this email.",
  });
  const text = [
    `Join ${organizationName} on DocuMind`,
    "",
    `${inviterName || inviterEmail} (${inviterEmail}) invited you to ${organizationName}.`,
    "Sign in or create an account with this email address to accept:",
    url,
    "",
    "The invitation expires in 48 hours. If you weren't expecting it, you can ignore this email.",
  ].join("\n");
  return { subject, html, text };
}

/**
 * Keyed on the invitation id + its expiry, so a retried request never
 * double-sends, while a deliberate "Resend" (which extends the expiry) does.
 */
export async function sendInvitationEmail(input: InvitationEmailInput) {
  await sendEmail({
    to: input.email,
    ...invitationEmailContent(input),
    idempotencyKey: `org-invitation/${input.invitationId}/${input.expiresAt.getTime()}`,
  });
}
