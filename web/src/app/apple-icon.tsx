import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Home-screen icon: the logo mark, full-bleed (iOS applies its own corner mask). */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: "#1a5d48" }}>
        <svg width="180" height="180" viewBox="4 4 24 24">
          <path d="M10.5 7.5h7.4l4.6 4.6v11.4a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V8.5a1 1 0 0 1 1-1Z" fill="#f7fbf9" />
          <path d="M17.9 7.5v3.6a1 1 0 0 0 1 1h3.6" fill="#1a5d48" fillOpacity="0.28" />
          <rect x="11.75" y="12.6" width="5" height="1.5" rx="0.75" fill="#1a5d48" opacity="0.45" />
          <rect x="10.75" y="15.6" width="10.5" height="3.2" rx="0.8" fill="#f6e5a4" />
          <rect x="11.75" y="16.45" width="8.5" height="1.5" rx="0.75" fill="#2a2313" opacity="0.85" />
          <rect x="11.75" y="20.4" width="6.5" height="1.5" rx="0.75" fill="#1a5d48" opacity="0.45" />
        </svg>
      </div>
    ),
    size,
  );
}
