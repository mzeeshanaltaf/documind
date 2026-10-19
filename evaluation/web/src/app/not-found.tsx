import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/button-link";

export const metadata: Metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <div className="flex min-h-svh flex-1 flex-col px-4 py-8 sm:px-10">
      <Link
        href="/"
        aria-label="Evaluation home"
        className="self-start rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <Logo />
      </Link>
      <main className="flex flex-1 items-center justify-center py-16">
        <div className="flex max-w-md flex-col items-start gap-4">
          <p className="font-mono text-xs text-muted-foreground">404</p>
          <h1 className="font-heading text-3xl leading-tight font-semibold tracking-tight">Not found</h1>
          <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">
            That dataset, run or case doesn&apos;t exist, or it was deleted.
          </p>
          <ButtonLink href="/" className="mt-2">
            Back to the dashboard
          </ButtonLink>
        </div>
      </main>
    </div>
  );
}
