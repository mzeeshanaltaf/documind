import "server-only";

/**
 * Brand-matched, email-client-safe shell: tables + inline styles only.
 * Hex values are the sRGB equivalents of the OKLCH tokens in globals.css
 * (see DESIGN.md). No hosted images, so nothing breaks before deploy.
 */
export const EMAIL_COLORS = {
  paper: "#f9fcfa",
  surface: "#ffffff",
  ink: "#121916",
  muted: "#616a66",
  border: "#dce1de",
  primary: "#1a5d48",
  primaryText: "#f7fbf9",
  highlight: "#f6e5a4",
  highlightText: "#2a2313",
  well: "#eef2f0",
} as const;

const SERIF = "'Source Serif 4',Georgia,'Times New Roman',serif";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function emailLayout({
  preheader,
  heading,
  body,
  footer,
}: {
  preheader: string;
  heading: string;
  body: string;
  footer: string;
}) {
  const c = EMAIL_COLORS;
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:${c.paper};font-family:${SANS};">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${c.paper};padding:32px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:${c.surface};border:1px solid ${c.border};border-radius:12px;">
          <tr><td style="padding:28px 32px 0 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0"><tr>
              <td style="width:26px;height:26px;background-color:${c.primary};border-radius:7px;text-align:center;vertical-align:middle;">
                <div style="display:inline-block;width:12px;height:4px;margin-top:2px;background-color:${c.highlight};border-radius:1px;"></div>
              </td>
              <td style="padding-left:9px;font-family:${SERIF};font-size:19px;font-weight:600;color:${c.ink};letter-spacing:-0.2px;">DocuMind</td>
            </tr></table>
          </td></tr>
          <tr><td style="padding:24px 32px 0 32px;">
            <h1 style="margin:0;font-family:${SERIF};font-size:23px;line-height:30px;font-weight:600;color:${c.ink};">${heading}</h1>
          </td></tr>
          <tr><td style="padding:10px 32px 0 32px;font-size:14px;line-height:22px;color:${c.muted};">
            ${body}
          </td></tr>
          <tr><td style="padding:28px 32px 28px 32px;">
            <hr style="border:none;border-top:1px solid ${c.border};margin:0 0 14px 0;" />
            <p style="margin:0;font-size:12px;line-height:19px;color:${c.muted};">${footer}</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}
