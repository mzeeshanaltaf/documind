import { FileTextIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminPlaceholder } from "@/components/app/admin-placeholder";
import { PageSkeleton } from "@/components/app/shell-skeleton";

export const metadata: Metadata = { title: "Documents" };

export default function DocumentsPage({ params }: PageProps<"/app/[orgSlug]/documents">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AdminPlaceholder
        params={params}
        icon={FileTextIcon}
        title="Documents"
        description="The policy PDFs this organization's answers are drawn from."
        emptyTitle="No documents yet"
        emptyDescription="Uploading and indexing PDFs arrives with document ingestion."
      />
    </Suspense>
  );
}
