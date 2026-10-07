import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/button-link";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false },
};

/**
 * Also shown for pages someone isn't allowed to see (`notFound()` in the auth
 * guards), so the copy doesn't claim the page doesn't exist.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-svh flex-1 flex-col px-4 py-8 sm:px-10">
      <Link
        href="/"
        aria-label="DocuMind home"
        className="self-start rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <Logo />
      </Link>
      <main className="flex flex-1 items-center justify-center py-16">
        <div className="flex max-w-md flex-col items-start gap-4">
          <p className="font-mono text-xs text-muted-foreground">404</p>
          <h1 className="font-heading text-3xl leading-tight font-semibold tracking-tight">Page not found</h1>
          <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">
            This page may have moved, or your account may not have access to it. If someone sent you this link, ask
            them to check that you&apos;re a member of the right organization.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <ButtonLink href="/app">Open DocuMind</ButtonLink>
            <ButtonLink href="/" variant="outline">
              Home page
            </ButtonLink>
          </div>
        </div>
      </main>
    </div>
  );
}
