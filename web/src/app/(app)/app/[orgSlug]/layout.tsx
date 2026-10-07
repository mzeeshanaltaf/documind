import { cookies } from "next/headers";
import { after } from "next/server";
import { Suspense } from "react";
import { AppSidebar } from "@/components/app/app-sidebar";
import { ShellSkeleton } from "@/components/app/shell-skeleton";
import { MobileTopBar } from "@/components/app/mobile-top-bar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { listAccessibleOrgs, requireOrgAccess } from "@/lib/auth-guards";
import { pool } from "@/lib/db";

export default function OrgLayout({ children, params }: LayoutProps<"/app/[orgSlug]">) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <OrgShell params={params}>{children}</OrgShell>
    </Suspense>
  );
}

async function OrgShell({ params, children }: { params: Promise<{ orgSlug: string }>; children: React.ReactNode }) {
  const { orgSlug } = await params;
  const { user, session, org, isAdmin } = await requireOrgAccess(orgSlug);
  const [orgs, cookieStore] = await Promise.all([listAccessibleOrgs(user), cookies()]);
  const sidebarOpen = cookieStore.get("sidebar_state")?.value !== "false";

  // Remember the last org visited so /app reopens it. Done directly on the
  // session row: setActiveOrganization requires membership, which admins may lack.
  if (session.activeOrganizationId !== org.id) {
    after(() =>
      pool.query(`update session set "activeOrganizationId" = $1 where id = $2`, [org.id, session.id]),
    );
  }

  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      <AppSidebar
        org={{ id: org.id, name: org.name, slug: org.slug }}
        orgs={orgs.map((o) => ({ id: o.id, name: o.name, slug: o.slug }))}
        user={{ name: user.name, email: user.email, image: user.image ?? null, isAdmin }}
      />
      {/* min-w-0: a flex child defaults to min-width:auto, so wide tables would stretch the page. */}
      <SidebarInset className="min-w-0">
        <MobileTopBar orgSlug={org.slug} orgName={org.name} />
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
