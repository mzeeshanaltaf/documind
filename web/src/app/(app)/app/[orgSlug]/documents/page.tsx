import type { Metadata } from "next";
import { Suspense } from "react";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { PageSkeleton } from "@/components/app/shell-skeleton";
import { DocumentsView } from "@/components/documents/documents-view";
import { apiJson } from "@/lib/api";
import { type DocumentRow, isSearchable } from "@/lib/api-types";
import { requireOrgAccess } from "@/lib/auth-guards";

export const metadata: Metadata = { title: "Documents" };

export default function DocumentsPage({ params }: PageProps<"/app/[orgSlug]/documents">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Documents params={params} />
    </Suspense>
  );
}

// Admins manage the library; members get a read-only list of what they can ask about.
async function Documents({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { user, org, isAdmin } = await requireOrgAccess(orgSlug);
  const { documents } = await apiJson<{ documents: DocumentRow[] }>(`orgs/${org.id}/documents`, { userId: user.id });

  return (
    <PageContainer className="max-w-6xl">
      <PageHeader
        title="Documents"
        description={
          isAdmin
            ? `The policy PDFs ${org.name}'s answers are drawn from. Uploads are indexed in the background.`
            : `The documents you can ask about in ${org.name}. Open one to read it in full.`
        }
      />
      <DocumentsView
        orgId={org.id}
        orgSlug={org.slug}
        orgName={org.name}
        canManage={isAdmin}
        initialDocuments={isAdmin ? documents : documents.filter(isSearchable)}
      />
    </PageContainer>
  );
}
