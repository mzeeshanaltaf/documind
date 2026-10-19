import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { PageSkeleton } from "@/components/app/shell-skeleton";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PromptOut } from "@/lib/api-types";
import { requireAdmin } from "@/lib/auth-guards";
import { apiJson } from "@/lib/eval-api";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Judge prompts" };

export default function PromptsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Prompts />
    </Suspense>
  );
}

async function Prompts() {
  const { user } = await requireAdmin();
  const prompts = await apiJson<PromptOut[]>("prompts", { userId: user.id });

  return (
    <PageContainer className="max-w-5xl">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted-foreground">
        <Link href="/settings" className="hover:text-foreground hover:underline">
          Settings
        </Link>
      </nav>
      <PageHeader
        title="Judge prompts"
        description="Synced from evaluation/api/app/judge/prompts/*.md. Editing a file adds a version; runs keep judging with the versions they recorded."
      />
      <div className="@container overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Prompt</TableHead>
              <TableHead className="text-right">Current</TableHead>
              <TableHead className="hidden @2xl:table-cell">Model</TableHead>
              <TableHead className="hidden @3xl:table-cell">Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {prompts.map((p) => (
              <TableRow key={p.key}>
                <TableCell className="max-w-0 min-w-56 @2xl:max-w-md">
                  <Link href={`/settings/prompts/${encodeURIComponent(p.key)}`} className="flex flex-col gap-0.5 hover:underline">
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-xs font-medium">{p.key}</span>
                      {!p.file_present && <Badge variant="secondary">file removed</Badge>}
                    </span>
                    {p.description && <span className="truncate text-sm text-muted-foreground">{p.description}</span>}
                  </Link>
                </TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">
                  v{p.current_version ?? p.latest?.version ?? "?"}
                  <span className="text-muted-foreground"> of {p.versions}</span>
                </TableCell>
                <TableCell className="hidden font-mono text-xs @2xl:table-cell">
                  {p.latest?.model}
                  {p.latest?.effort && <span className="text-muted-foreground"> · {p.latest.effort}</span>}
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground tabular-nums @3xl:table-cell">
                  {formatDateTime(p.latest?.created_at)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </PageContainer>
  );
}
