import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { SignOutButton } from "@/components/auth/sign-out-button";

/** Minimal chrome for signed-in pages outside an org (empty state, new org). */
export function StandaloneShell({ email, children }: { email: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-1 flex-col">
      <header className="flex items-center justify-between gap-4 border-b px-5 py-3 md:px-8">
        <Link href="/app" className="rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
          <Logo />
        </Link>
        <div className="flex items-center gap-3">
          <span className="hidden truncate text-sm text-muted-foreground sm:inline">{email}</span>
          <SignOutButton variant="ghost" size="sm" />
        </div>
      </header>
      {children}
    </div>
  );
}
