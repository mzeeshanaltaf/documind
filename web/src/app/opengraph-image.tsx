import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

export const alt = "DocuMind: turn company documents into an intelligent assistant";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// sRGB equivalents of the design tokens (see DESIGN.md › Email): OG renderers can't read CSS variables.
const PAPER = "#f9fcfa";
const SHELF = "#f1f5f3";
const INK = "#121916";
const MUTED = "#616a66";
const RULE = "#dce1de";
const INK_GREEN = "#1a5d48";
const HIGHLIGHT = "#f6e5a4";
const HIGHLIGHT_INK = "#2a2313";

// Read at module scope so the image is generated once at build time (a read inside
// the handler counts as uncached I/O under cacheComponents and makes the route dynamic).
const font = (file: string) => readFile(path.join(process.cwd(), "assets/fonts", file));
const [serif, sans, sansMedium, mono] = await Promise.all([
  font("source-serif-4-latin-600-normal.woff"),
  font("instrument-sans-latin-400-normal.woff"),
  font("instrument-sans-latin-500-normal.woff"),
  font("geist-mono-latin-400-normal.woff"),
]);

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: PAPER, color: INK, fontFamily: "Instrument Sans" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 690, padding: "64px 0 64px 72px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <svg width="52" height="52" viewBox="0 0 32 32">
              <rect width="32" height="32" rx="8" fill={INK_GREEN} />
              <path d="M10.5 7.5h7.4l4.6 4.6v11.4a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V8.5a1 1 0 0 1 1-1Z" fill="#f7fbf9" />
              <path d="M17.9 7.5v3.6a1 1 0 0 0 1 1h3.6" fill={INK_GREEN} fillOpacity="0.28" />
              <rect x="11.75" y="12.6" width="5" height="1.5" rx="0.75" fill={INK_GREEN} opacity="0.45" />
              <rect x="10.75" y="15.6" width="10.5" height="3.2" rx="0.8" fill={HIGHLIGHT} />
              <rect x="11.75" y="16.45" width="8.5" height="1.5" rx="0.75" fill={HIGHLIGHT_INK} opacity="0.85" />
              <rect x="11.75" y="20.4" width="6.5" height="1.5" rx="0.75" fill={INK_GREEN} opacity="0.45" />
            </svg>
            <span style={{ fontFamily: "Source Serif 4", fontSize: 40, letterSpacing: "-0.015em" }}>DocuMind</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            <span style={{ fontFamily: "Source Serif 4", fontSize: 66, lineHeight: 1.04, letterSpacing: "-0.028em" }}>
              Turn company documents into an intelligent assistant.
            </span>
            <span style={{ fontSize: 26, lineHeight: 1.4, color: MUTED }}>
              Answers from your policies, with citations that open the exact page.
            </span>
          </div>
        </div>

        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", background: SHELF, borderLeft: `1px solid ${RULE}`, padding: "0 44px" }}>
          <div style={{ display: "flex", flexDirection: "column", width: "100%", background: PAPER, border: `1px solid ${RULE}`, borderRadius: 14, padding: 26 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderBottom: `1px solid ${RULE}`, paddingBottom: 14 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontFamily: "Geist Mono", fontSize: 15, color: MUTED }}>SIM-HR-102</span>
                <span style={{ fontFamily: "Source Serif 4", fontSize: 21 }}>Germany HR Manual</span>
              </div>
              <span style={{ fontFamily: "Geist Mono", fontSize: 15, color: MUTED }}>p. 16</span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, paddingTop: 16 }}>
              <span style={{ fontFamily: "Geist Mono", fontSize: 15, color: MUTED }}>5.2</span>
              <span style={{ fontFamily: "Source Serif 4", fontSize: 19 }}>Annual Leave</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", paddingTop: 10, fontSize: 18, lineHeight: 1.5, color: MUTED }}>
              <span style={{ background: HIGHLIGHT, color: HIGHLIGHT_INK, borderRadius: 4, padding: "2px 6px" }}>
                Unused leave carries over to March 31 of the following year.
              </span>
              <span style={{ paddingTop: 6 }}>Leave does not lapse unless the Company has written to the employee in good time.</span>
            </div>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Source Serif 4", data: serif, weight: 600, style: "normal" },
        { name: "Instrument Sans", data: sans, weight: 400, style: "normal" },
        { name: "Instrument Sans", data: sansMedium, weight: 500, style: "normal" },
        { name: "Geist Mono", data: mono, weight: 400, style: "normal" },
      ],
    },
  );
}
