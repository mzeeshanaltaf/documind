import type { Metadata } from "next";
import { Suspense } from "react";
import { AnalyticsDashboard } from "@/components/analytics/analytics-dashboard";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { PageSkeleton } from "@/components/app/shell-skeleton";
import { resolveRange } from "@/lib/analytics-range";
import { apiJson } from "@/lib/api";
import type { AdminOrg, Analytics } from "@/lib/api-types";
import { requireAdmin } from "@/lib/auth-guards";

export const metadata: Metadata = { title: "Platform analytics" };

export default function PlatformAnalyticsPage({ searchParams }: PageProps<"/admin/analytics">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PlatformAnalytics searchParams={searchParams} />
    </Suspense>
  );
}

async function PlatformAnalytics({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const { user } = await requireAdmin();
  const range = resolveRange(query, new Date());
  const { orgs } = await apiJson<{ orgs: AdminOrg[] }>("admin/orgs", { userId: user.id });
  const requested = typeof query.org === "string" ? query.org : null;
  const orgId = requested && orgs.some((o) => o.id === requested) ? requested : null;
  const data = await apiJson<Analytics>("analytics", {
    userId: user.id,
    query: { org_id: orgId, from: range.from, to: range.to, granularity: range.granularity },
  });

  return (
    <PageContainer className="max-w-6xl">
      <PageHeader title="Platform analytics" description="Usage and cost across every organization, or one at a time." />
      <AnalyticsDashboard data={data} range={range} orgs={orgs.map((o) => ({ value: o.id, label: o.name }))} orgId={orgId} />
    </PageContainer>
  );
}
