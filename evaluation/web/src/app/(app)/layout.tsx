import { cookies } from "next/headers";
import { Suspense } from "react";
import { EvalSidebar } from "@/components/app/eval-sidebar";
import { MobileTopBar } from "@/components/app/mobile-top-bar";
import { ShellSkeleton } from "@/components/app/shell-skeleton";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { requireAdmin } from "@/lib/auth-guards";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}

async function AppShell({ children }: { children: React.ReactNode }) {
  const [{ user }, cookieStore] = await Promise.all([requireAdmin(), cookies()]);
  const sidebarOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      <EvalSidebar user={{ name: user.name, email: user.email, image: user.image ?? null }} />
      {/* min-w-0: a flex child defaults to min-width:auto, so wide tables would stretch the page. */}
      <SidebarInset className="min-w-0">
        <MobileTopBar />
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
