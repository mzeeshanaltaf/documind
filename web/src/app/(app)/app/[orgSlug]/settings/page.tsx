import { Settings2Icon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminPlaceholder } from "@/components/app/admin-placeholder";
import { PageSkeleton } from "@/components/app/shell-skeleton";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage({ params }: PageProps<"/app/[orgSlug]/settings">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AdminPlaceholder
        params={params}
        icon={Settings2Icon}
        title="Settings"
        description="Model and service-tier choices for this organization."
        emptyTitle="Nothing to configure yet"
        emptyDescription="Chat and ingestion settings appear once the assistant is connected."
      />
    </Suspense>
  );
}
