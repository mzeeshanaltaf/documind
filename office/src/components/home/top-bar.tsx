import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/brand/logo";
import { Skeleton } from "@/components/ui/skeleton";
import { requireSession } from "@/lib/auth-guards";
import { UserMenu } from "./user-menu";

/**
 * The slim bar over the picker pages (organizations, the globe): logo home, account menu. The
 * game route has none: the game fills the screen and its Esc menu covers the same ground.
 */
export function TopBar() {
  return (
    <header className="relative z-10 flex h-16 shrink-0 items-center justify-between gap-4 border-b bg-background px-4 sm:px-10">
      <Link
        href="/?pick=1"
        aria-label="Office home"
        className="rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <Logo />
      </Link>
      <Suspense fallback={<Skeleton className="size-8 rounded-full" />}>
        <AccountMenu />
      </Suspense>
    </header>
  );
}

async function AccountMenu() {
  const { user } = await requireSession();
  return <UserMenu user={{ name: user.name, email: user.email, image: user.image ?? null }} />;
}
