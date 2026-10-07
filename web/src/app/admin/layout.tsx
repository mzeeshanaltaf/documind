import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
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
      <header className="flex items-center justify-between gap-4 border-b bg-sidebar px-5 py-3 md:px-8">
        <div className="flex items-center gap-3">
          <Link href="/app" className="rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
            <Logo />
          </Link>
          <Badge variant="outline">Platform admin</Badge>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden truncate text-sm text-muted-foreground md:inline">{user.email}</span>
          <ButtonLink href="/app" variant="ghost" size="sm">
            <ArrowLeftIcon data-icon="inline-start" />
            Back to app
          </ButtonLink>
          <SignOutButton variant="ghost" size="sm" />
        </div>
      </header>
      {children}
    </div>
  );
}
