import { BuildingIcon, ChartLineIcon, PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { OrgAvatar } from "@/components/app/org-avatar";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { PageSkeleton } from "@/components/app/shell-skeleton";
import { ButtonLink } from "@/components/button-link";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiJson } from "@/lib/api";
import type { AdminOrg } from "@/lib/api-types";
import { requireAdmin } from "@/lib/auth-guards";
import { formatCost, formatCount, formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Organizations" };

export default function AdminIndexPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Organizations />
    </Suspense>
  );
}

async function Organizations() {
  const { user } = await requireAdmin();
  const { orgs } = await apiJson<{ orgs: AdminOrg[] }>("admin/orgs", { userId: user.id });
  const totalCost = orgs.reduce((sum, o) => sum + o.cost_30d_usd, 0);

  return (
    <PageContainer className="max-w-6xl">
      <PageHeader
        title="Organizations"
        description="Every organization on DocuMind, with its library, people and the last 30 days of LLM spend."
        actions={
          <ButtonLink href="/app/new-org">
            <PlusIcon data-icon="inline-start" />
            New organization
          </ButtonLink>
        }
      />

      {orgs.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BuildingIcon />
            </EmptyMedia>
            <EmptyTitle>No organizations yet</EmptyTitle>
            <EmptyDescription>Create one, upload its policy PDFs and add the people who should ask about them.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <ButtonLink href="/app/new-org">Create an organization</ButtonLink>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organization</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Documents</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Members</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Conversations</TableHead>
                  <TableHead className="text-right">30-day cost</TableHead>
                  <TableHead className="hidden lg:table-cell">Created</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">Analytics</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orgs.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="max-w-0 min-w-36 sm:max-w-none">
                      <Link
                        href={`/app/${o.slug}/chat`}
                        className="flex min-w-0 items-center gap-3 rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                      >
                        <OrgAvatar name={o.name} />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-medium hover:underline">{o.name}</span>
                          <span className="truncate font-mono text-[0.7rem] text-muted-foreground">{o.slug}</span>
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">
                      <Link href={`/app/${o.slug}/documents`} className="hover:underline">
                        {formatCount(o.documents)}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">
                      <Link href={`/app/${o.slug}/members`} className="hover:underline">
                        {formatCount(o.members)}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden text-right text-muted-foreground tabular-nums md:table-cell">
                      {formatCount(o.conversations)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatCost(o.cost_30d_usd)}</TableCell>
                    <TableCell className="hidden text-muted-foreground tabular-nums lg:table-cell">{formatDate(o.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <ButtonLink
                        href={`/app/${o.slug}/analytics`}
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Analytics for ${o.name}`}
                      >
                        <ChartLineIcon />
                      </ButtonLink>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="mt-3 text-sm text-muted-foreground tabular-nums">
            {orgs.length} organization{orgs.length === 1 ? "" : "s"} · {formatCost(totalCost)} in the last 30 days
          </p>
        </>
      )}
    </PageContainer>
  );
}
