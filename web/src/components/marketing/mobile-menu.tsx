"use client";

import { MenuIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useId, useRef } from "react";
import { Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/button-link";
import { cn } from "@/lib/utils";
import { CONTAINER, SECTION_LINKS } from "./nav";

const ICON_BUTTON =
  "inline-flex size-9 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

/**
 * Small-screen menu as a top sheet on the native Popover API: it opens, light-dismisses
 * and closes on Escape without JavaScript. Hydrated, it also closes when a link is
 * followed (same-page anchors don't unload the page).
 */
export function MobileMenu({ signedIn }: { signedIn: boolean }) {
  const id = useId();
  const sheet = useRef<HTMLDivElement>(null);

  return (
    <>
      <button type="button" popoverTarget={id} aria-label="Open menu" className={cn(ICON_BUTTON, "lg:hidden")}>
        <MenuIcon className="size-5" aria-hidden />
      </button>

      <div
        id={id}
        ref={sheet}
        popover="auto"
        aria-label="Menu"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a")) sheet.current?.hidePopover();
        }}
        className={cn(
          "fixed inset-x-0 top-0 bottom-auto m-0 h-auto max-h-svh w-full max-w-none overflow-y-auto border-b bg-background p-0 text-foreground shadow-lg",
          "opacity-0 -translate-y-3 transition-[opacity,translate,display,overlay] transition-discrete duration-200 ease-out",
          "open:translate-y-0 open:opacity-100 starting:open:-translate-y-3 starting:open:opacity-0",
          "backdrop:bg-foreground/25 backdrop:transition-opacity",
        )}
      >
        <div className={cn(CONTAINER, "flex h-16 items-center justify-between")}>
          <Link href="/" aria-label="DocuMind home" className="rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
            <Logo />
          </Link>
          <button type="button" popoverTarget={id} popoverTargetAction="hide" aria-label="Close menu" className={ICON_BUTTON}>
            <XIcon className="size-5" aria-hidden />
          </button>
        </div>

        <nav aria-label="Main" className={cn(CONTAINER, "flex flex-col pb-2")}>
          {[...SECTION_LINKS, { href: "/contact", label: "Contact" }].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="-mx-2 rounded-md border-b border-border/60 px-2 py-3.5 font-heading text-xl font-semibold last:border-b-0 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className={cn(CONTAINER, "flex flex-col gap-2 pt-2 pb-6")}>
          {signedIn ? (
            <ButtonLink href="/app" size="lg" className="h-11 text-[0.9375rem]">
              Open app
            </ButtonLink>
          ) : (
            <>
              <ButtonLink href="/sign-up" size="lg" className="h-11 text-[0.9375rem]">
                Get started
              </ButtonLink>
              <ButtonLink href="/sign-in" variant="outline" size="lg" className="h-11 text-[0.9375rem]">
                Sign in
              </ButtonLink>
            </>
          )}
        </div>
      </div>
    </>
  );
}
