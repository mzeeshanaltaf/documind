import type { Metadata } from "next";
import { Suspense } from "react";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { ShellSkeleton } from "@/components/app/shell-skeleton";
import { StandaloneShell } from "@/components/app/standalone-shell";
import { requireSession } from "@/lib/auth-guards";
import { pool } from "@/lib/db";
import { IS_EVAL_ORG_SQL } from "@/lib/org-members";
import { JoinOrgList } from "./join-org-list";

export const metadata: Metadata = { title: "Join organizations" };

export default function JoinPage() {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <Join />
    </Suspense>
  );
}

async function Join() {
  const { user } = await requireSession();
  const { rows } = await pool.query<{ id: string; name: string; slug: string; joined: boolean }>(
    `select o.id, o.name, o.slug,
            exists (select 1 from member m where m."organizationId" = o.id and m."userId" = $1) as joined
       from organization o
      where not (${IS_EVAL_ORG_SQL})
      order by o.name`,
    [user.id],
  );
  const toItem = ({ id, name, slug }: (typeof rows)[number]) => ({ id, name, slug });

  return (
    <StandaloneShell email={user.email}>
      <PageContainer className="max-w-xl">
        <PageHeader
          title="Join organizations"
          description="Join one or more organizations to ask questions about their policy documents."
        />
        <JoinOrgList available={rows.filter((r) => !r.joined).map(toItem)} joined={rows.filter((r) => r.joined).map(toItem)} />
      </PageContainer>
    </StandaloneShell>
  );
}
