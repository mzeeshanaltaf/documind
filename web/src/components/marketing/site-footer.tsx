import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import { CONTAINER } from "./nav";

const FOOTER_LINK =
  "inline-flex min-h-11 items-center rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:min-h-0";

/** Captured into the static shell at build time and refreshed on revalidation. */
async function CopyrightYear() {
  "use cache";
  return <>{new Date().getFullYear()}</>;
}

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className={cn(CONTAINER, "flex flex-col gap-8 py-10 sm:flex-row sm:items-end sm:justify-between")}>
        <div className="flex flex-col gap-3">
          <Link href="/" aria-label="DocuMind home" className="self-start rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
            <Logo />
          </Link>
          <p className="max-w-xs text-sm text-muted-foreground">Turn company documents into an intelligent assistant.</p>
        </div>

        <div className="flex flex-col gap-3 sm:items-end">
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 sm:gap-y-2">
            <Link href="/privacy" className={FOOTER_LINK}>
              Privacy
            </Link>
            <Link href="/contact" className={FOOTER_LINK}>
              Contact
            </Link>
            <Link href="/sign-in" className={FOOTER_LINK}>
              Sign in
            </Link>
          </nav>
          <p className="text-xs text-muted-foreground">
            © <CopyrightYear /> DocuMind
          </p>
        </div>
      </div>
    </footer>
  );
}
