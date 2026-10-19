import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RunOut } from "@/lib/api-types";
import { formatCost, formatDateTime, shortId } from "@/lib/format";
import { RunProgress } from "./run-progress";
import { RunStatusBadge } from "./status";

export function runTitle(run: Pick<RunOut, "name" | "id">): string {
  return run.name || `Run ${shortId(run.id)}`;
}

/** Bordered table; columns hide by the table's own width (@container), as in DocuMind. */
export function RunsTable({ runs }: { runs: RunOut[] }) {
  return (
    <div className="@container overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Run</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden @xl:table-cell">Progress</TableHead>
            <TableHead className="hidden text-right @3xl:table-cell">Cost</TableHead>
            <TableHead className="hidden @4xl:table-cell">Started</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <TableRow key={run.id}>
              <TableCell className="max-w-0 min-w-48 @xl:max-w-none">
                <Link
                  href={`/runs/${run.id}`}
                  className="flex min-w-0 flex-col gap-0.5 rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <span className="truncate font-medium hover:underline">{runTitle(run)}</span>
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="font-mono">{run.dataset ? `${run.dataset.slug} v${run.dataset.version}` : "dataset n/a"}</span>
                    <span className="font-mono">{run.org_slug}</span>
                    <span>{run.mode === "full" ? "full" : "retrieval only"}</span>
                    {run.source_run_id && <span>rejudge</span>}
                    {run.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="h-4 px-1.5 text-[0.65rem]">
                        {tag}
                      </Badge>
                    ))}
                  </span>
                </Link>
              </TableCell>
              <TableCell>
                <RunStatusBadge status={run.status} reason={run.status_reason} />
              </TableCell>
              <TableCell className="hidden @xl:table-cell">
                <RunProgress run={run} />
              </TableCell>
              <TableCell className="hidden text-right tabular-nums @3xl:table-cell">
                <span className="flex flex-col">
                  <span>{formatCost(run.documind_cost_usd + run.judge_cost_usd)}</span>
                  <span className="text-xs text-muted-foreground">judge {formatCost(run.judge_cost_usd)}</span>
                </span>
              </TableCell>
              <TableCell className="hidden text-sm text-muted-foreground tabular-nums @4xl:table-cell">
                {formatDateTime(run.started_at ?? run.created_at)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
