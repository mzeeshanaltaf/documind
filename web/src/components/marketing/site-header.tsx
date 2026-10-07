import { getSessionCookie } from "better-auth/cookies";
import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/button-link";
import { cn } from "@/lib/utils";
import { MobileMenu } from "./mobile-menu";
import { CONTAINER, SECTION_LINKS } from "./nav";

const NAV_LINK =
  "rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background">
      <div className={cn(CONTAINER, "flex h-16 items-center gap-6")}>
        <Link
          href="/"
          aria-label="DocuMind home"
          className="shrink-0 rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <Logo />
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-0.5 lg:flex">
          {SECTION_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className={NAV_LINK}>
              {link.label}
            </Link>
          ))}
          <Link href="/contact" className={NAV_LINK}>
            Contact
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {/* The signed-out actions are the static shell; the cookie check streams in. */}
          <Suspense fallback={<HeaderActions signedIn={false} />}>
            <SessionAwareActions />
          </Suspense>
        </div>
      </div>
    </header>
  );
}

/** Cookie presence only (no DB hit); the app's own guards do the real check. */
async function SessionAwareActions() {
  const signedIn = !!getSessionCookie(await headers());
  return <HeaderActions signedIn={signedIn} />;
}

function HeaderActions({ signedIn }: { signedIn: boolean }) {
  return (
    <>
      {signedIn ? (
        <ButtonLink href="/app" className="h-9 px-3.5">
          Open app
        </ButtonLink>
      ) : (
        <>
          <ButtonLink href="/sign-in" variant="ghost" className="hidden h-9 px-3 sm:inline-flex">
            Sign in
          </ButtonLink>
          <ButtonLink href="/sign-up" className="h-9 px-3.5">
            Get started
          </ButtonLink>
        </>
      )}
      <MobileMenu signedIn={signedIn} />
    </>
  );
}
