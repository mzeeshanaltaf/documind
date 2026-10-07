import type { Metadata } from "next";
import { Suspense } from "react";
import { AnalyticsDashboard } from "@/components/analytics/analytics-dashboard";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { PageSkeleton } from "@/components/app/shell-skeleton";
import { resolveRange } from "@/lib/analytics-range";
import { apiJson } from "@/lib/api";
import type { Analytics } from "@/lib/api-types";
import { requireOrgAdmin } from "@/lib/auth-guards";

export const metadata: Metadata = { title: "Analytics" };

export default function AnalyticsPage({ params, searchParams }: PageProps<"/app/[orgSlug]/analytics">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <OrgAnalytics params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function OrgAnalytics({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ orgSlug }, query] = await Promise.all([params, searchParams]);
  const { user, org } = await requireOrgAdmin(orgSlug);
  const range = resolveRange(query, new Date());
  const data = await apiJson<Analytics>("analytics", {
    userId: user.id,
    query: { org_id: org.id, from: range.from, to: range.to, granularity: range.granularity },
  });

  return (
    <PageContainer className="max-w-6xl">
      <PageHeader title="Analytics" description={`What ${org.name}'s questions cost, how fast they're answered and what gets cited.`} />
      <AnalyticsDashboard data={data} range={range} />
    </PageContainer>
  );
}
