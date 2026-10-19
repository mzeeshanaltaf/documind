import type { Metadata, Viewport } from "next";
import { Geist_Mono, Instrument_Sans, Source_Serif_4 } from "next/font/google";
import { Providers } from "@/components/providers";
import { SITE_NAME } from "@/lib/site";
import "./globals.css";

// The same three families as DocuMind (DESIGN.md › Typography).
// UI sans: all labels, buttons, body copy and data.
const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
});

// Display serif: wordmark, page titles. Never UI labels.
const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  axes: ["opsz"],
});

// Mono: document codes, section numbers, case keys and scores.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  description: "Measures DocuMind end to end: retrieval, answers, citations, safety, cost and latency.",
  applicationName: SITE_NAME,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9fcfa" },
    { media: "(prefers-color-scheme: dark)", color: "#121715" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${instrumentSans.variable} ${sourceSerif.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
