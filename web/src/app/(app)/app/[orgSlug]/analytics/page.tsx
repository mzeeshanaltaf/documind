import { ChartLineIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminPlaceholder } from "@/components/app/admin-placeholder";
import { PageSkeleton } from "@/components/app/shell-skeleton";

export const metadata: Metadata = { title: "Analytics" };

export default function AnalyticsPage({ params }: PageProps<"/app/[orgSlug]/analytics">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AdminPlaceholder
        params={params}
        icon={ChartLineIcon}
        title="Analytics"
        description="Questions asked, documents cited and model spend for this organization."
        emptyTitle="No activity to show"
        emptyDescription="Usage appears here once people start asking questions."
      />
    </Suspense>
  );
}
