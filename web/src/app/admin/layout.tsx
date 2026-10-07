import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { AdminNav } from "@/components/app/admin-nav";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { ShellSkeleton } from "@/components/app/shell-skeleton";
import { Logo } from "@/components/brand/logo";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/button-link";
import { requireAdmin } from "@/lib/auth-guards";

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <AdminShell>{children}</AdminShell>
    </Suspense>
  );
}

async function AdminShell({ children }: { children: React.ReactNode }) {
  const { user } = await requireAdmin();
  return (
    <div className="flex min-h-svh flex-1 flex-col">
      <header className="flex items-center justify-between gap-3 border-b bg-sidebar px-4 py-3 sm:px-5 md:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/app" className="rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
            <Logo />
          </Link>
          <Badge variant="outline" className="hidden sm:inline-flex">
            Platform admin
          </Badge>
        </div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <span className="hidden truncate text-sm text-muted-foreground md:inline">{user.email}</span>
          {/* Icon-only on phones; the label stays as the accessible name. */}
          <ButtonLink href="/app" variant="ghost" size="sm" aria-label="Back to app">
            <ArrowLeftIcon data-icon="inline-start" />
            <span className="hidden sm:inline">Back to app</span>
          </ButtonLink>
          <SignOutButton variant="ghost" size="sm" />
        </div>
      </header>
      <AdminNav />
      {children}
    </div>
  );
}
