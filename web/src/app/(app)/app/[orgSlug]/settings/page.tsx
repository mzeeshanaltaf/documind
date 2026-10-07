import type { Metadata } from "next";
import { Suspense } from "react";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { PageSkeleton } from "@/components/app/shell-skeleton";
import { SettingsForm } from "@/components/settings/settings-form";
import { apiJson } from "@/lib/api";
import type { OrgSettings } from "@/lib/api-types";
import { requireOrgAdmin } from "@/lib/auth-guards";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage({ params }: PageProps<"/app/[orgSlug]/settings">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Settings params={params} />
    </Suspense>
  );
}

async function Settings({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { user, org } = await requireOrgAdmin(orgSlug);
  const settings = await apiJson<OrgSettings>(`orgs/${org.id}/settings`, { userId: user.id });

  return (
    <PageContainer>
      <PageHeader
        title="Settings"
        description={`Which models answer questions in ${org.name}, and how their requests are billed.`}
      />
      <SettingsForm orgSlug={org.slug} initial={settings} />
    </PageContainer>
  );
}
