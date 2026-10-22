import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/brand/logo";
import { UserMenu } from "@/components/home/user-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { requireSession } from "@/lib/auth-guards";

export default function GameLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-svh flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b px-4 sm:px-10">
        <Link
          href="/"
          aria-label="Office home"
          className="rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <Logo />
        </Link>
        <Suspense fallback={<Skeleton className="size-8 rounded-full" />}>
          <AccountMenu />
        </Suspense>
      </header>
      {children}
    </div>
  );
}

async function AccountMenu() {
  const { user } = await requireSession();
  return <UserMenu user={{ name: user.name, email: user.email, image: user.image ?? null }} />;
}
