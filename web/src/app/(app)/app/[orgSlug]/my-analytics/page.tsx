import type { Metadata } from "next";
import { Suspense } from "react";
import { MyAnalyticsDashboard } from "@/components/analytics/my-analytics-dashboard";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { PageSkeleton } from "@/components/app/shell-skeleton";
import { resolveRange } from "@/lib/analytics-range";
import { apiJson } from "@/lib/api";
import type { MyAnalytics } from "@/lib/api-types";
import { requireOrgAccess } from "@/lib/auth-guards";

export const metadata: Metadata = { title: "My analytics" };

export default function MyAnalyticsPage({ params, searchParams }: PageProps<"/app/[orgSlug]/my-analytics">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <MyActivity params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function MyActivity({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ orgSlug }, query] = await Promise.all([params, searchParams]);
  const { user, org } = await requireOrgAccess(orgSlug);
  const range = resolveRange(query, new Date());
  const data = await apiJson<MyAnalytics>(`orgs/${org.id}/me/analytics`, {
    userId: user.id,
    query: { from: range.from, to: range.to, granularity: range.granularity },
  });

  return (
    <PageContainer className="max-w-6xl">
      <PageHeader title="My analytics" description={`Your own activity in ${org.name}: questions, tokens, ratings and how fast you got answers.`} />
      <MyAnalyticsDashboard data={data} range={range} />
    </PageContainer>
  );
}
