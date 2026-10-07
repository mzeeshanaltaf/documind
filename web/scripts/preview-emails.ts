// Writes the transactional email templates to HTML files for a visual check.
// Run from web/: pnpm tsx --conditions=react-server scripts/preview-emails.ts <out-dir>
import fs from "node:fs";
import path from "node:path";
import { invitationEmailContent } from "../src/lib/email/invitation-email";
import { otpEmailContent } from "../src/lib/email/otp-email";

const out = path.resolve(process.argv[2] ?? "email-previews");
fs.mkdirSync(out, { recursive: true });

const previews = {
  "otp-email-verification": otpEmailContent("482913", "email-verification"),
  "otp-forget-password": otpEmailContent("482913", "forget-password"),
  invitation: invitationEmailContent({
    invitationId: "example-invitation-id",
    email: "sam@simtora.example",
    organizationName: "Simtora Technologies",
    inviterName: "Dana Admin",
    inviterEmail: "dana@simtora.example",
    expiresAt: new Date(),
  }),
};

for (const [name, { subject, html, text }] of Object.entries(previews)) {
  fs.writeFileSync(path.join(out, `${name}.html`), html);
  fs.writeFileSync(path.join(out, `${name}.txt`), `Subject: ${subject}\n\n${text}`);
  console.log(`${name}: ${subject}`);
}
