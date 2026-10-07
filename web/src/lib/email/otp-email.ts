import "server-only";
import { EMAIL_COLORS as c, emailLayout } from "./layout";
import { sendEmail } from "./resend";

export type OtpEmailType = "email-verification" | "forget-password";

/** Keep in sync with emailOTP({ expiresIn }) in lib/auth.ts. */
export const OTP_EXPIRY_MINUTES = 10;

const COPY: Record<OtpEmailType, { subject: string; heading: string; intro: string; outro: string }> = {
  "email-verification": {
    subject: "Your DocuMind verification code",
    heading: "Confirm your email",
    intro: "Enter this code in DocuMind to finish setting up your account.",
    outro: "If you didn't create a DocuMind account, you can ignore this email.",
  },
  "forget-password": {
    subject: "Your DocuMind password reset code",
    heading: "Reset your password",
    intro: "Enter this code in DocuMind to choose a new password.",
    outro: "If you didn't ask to reset your password, you can ignore this email. Your password won't change.",
  },
};

export function otpEmailContent(otp: string, type: OtpEmailType) {
  const { subject, heading, intro, outro } = COPY[type];
  const body = `
    <p style="margin:0;">${intro}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;background-color:${c.well};border:1px solid ${c.border};border-radius:8px;">
      <tr><td align="center" style="padding:18px 16px;">
        <span style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:30px;font-weight:700;letter-spacing:10px;color:${c.ink};">${otp}</span>
      </td></tr>
    </table>
    <p style="margin:12px 0 0 0;font-size:13px;">This code expires in ${OTP_EXPIRY_MINUTES} minutes.</p>`;
  const html = emailLayout({ preheader: `Your code is ${otp}`, heading, body, footer: outro });
  const text = [
    heading,
    "",
    intro,
    "",
    `Code: ${otp}`,
    `This code expires in ${OTP_EXPIRY_MINUTES} minutes.`,
    "",
    outro,
  ].join("\n");
  return { subject, html, text };
}

/**
 * No idempotency key: every send carries a freshly rotated code, and "Resend
 * code" must genuinely send a new email.
 */
export async function sendOtpEmail(email: string, otp: string, type: OtpEmailType) {
  await sendEmail({ to: email, ...otpEmailContent(otp, type) });
}
