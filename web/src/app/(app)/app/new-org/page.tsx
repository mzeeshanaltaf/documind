import type { Metadata } from "next";
import { Suspense } from "react";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { ShellSkeleton } from "@/components/app/shell-skeleton";
import { StandaloneShell } from "@/components/app/standalone-shell";
import { requireAdmin } from "@/lib/auth-guards";
import { NewOrgForm } from "./new-org-form";

export const metadata: Metadata = { title: "New organization" };

export default function NewOrgPage() {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <NewOrg />
    </Suspense>
  );
}

async function NewOrg() {
  const { user } = await requireAdmin();
  return (
    <StandaloneShell email={user.email}>
      <PageContainer className="max-w-xl">
        <PageHeader
          title="New organization"
          description="One organization per company. You'll add its people and policy documents next."
        />
        <NewOrgForm />
      </PageContainer>
    </StandaloneShell>
  );
}
