import type { LucideIcon } from "lucide-react";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { requireOrgAdmin } from "@/lib/auth-guards";

/** Admin-only section that a later phase fills in. Still enforces the admin check server-side. */
export async function AdminPlaceholder({
  params,
  title,
  description,
  emptyTitle,
  emptyDescription,
  icon: Icon,
}: {
  params: Promise<{ orgSlug: string }>;
  title: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
  icon: LucideIcon;
}) {
  const { orgSlug } = await params;
  await requireOrgAdmin(orgSlug);
  return (
    <PageContainer>
      <PageHeader title={title} description={description} />
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Icon />
          </EmptyMedia>
          <EmptyTitle>{emptyTitle}</EmptyTitle>
          <EmptyDescription>{emptyDescription}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </PageContainer>
  );
}
