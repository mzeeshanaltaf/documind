import Link from "next/link";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { SyntheticBatch } from "@/lib/api-types";
import { formatCost, formatCount, formatDateTime } from "@/lib/format";
import { BatchStatusBadge, batchTitle } from "./labels";

/** Generation progress, then what the review made of it. */
export function BatchProgress({ batch }: { batch: SyntheticBatch }) {
  const done = batch.generated_count + batch.failed_count;
  const pct = batch.candidate_count ? Math.round((done / batch.candidate_count) * 100) : 0;
  const { approved, rejected, pending, committed } = batch.counts;
  return (
    <div className="flex min-w-32 flex-col gap-1.5">
      <Progress
        value={pct}
        aria-label={`${done} of ${batch.candidate_count} candidates generated`}
        className="gap-0"
      />
      <span className="text-xs text-muted-foreground tabular-nums">
        {done < batch.candidate_count ? (
          <>
            {formatCount(done)}/{formatCount(batch.candidate_count)} generated
          </>
        ) : (
          <>
            {formatCount(approved)} approved · {formatCount(rejected)} rejected
            {pending > 0 && <> · {formatCount(pending)} to review</>}
            {committed > 0 && <> · {formatCount(committed)} committed</>}
          </>
        )}
      </span>
    </div>
  );
}

export function BatchesTable({ batches }: { batches: SyntheticBatch[] }) {
  return (
    <div className="@container overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Batch</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden @xl:table-cell">Progress</TableHead>
            <TableHead className="hidden text-right @3xl:table-cell">Cost</TableHead>
            <TableHead className="hidden @4xl:table-cell">Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {batches.map((batch) => (
            <TableRow key={batch.id}>
              <TableCell className="max-w-0 min-w-48 @xl:max-w-none">
                <Link
                  href={`/synthetic/${batch.id}`}
                  className="flex min-w-0 flex-col gap-0.5 rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <span className="truncate font-medium hover:underline">{batchTitle(batch)}</span>
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    <span>{batch.kind === "enrichment" ? "references for" : "new cases"}</span>
                    {batch.target_dataset && (
                      <span className="font-mono">
                        {batch.target_dataset.slug}
                        {batch.kind === "enrichment" && batch.config.dataset_version
                          ? ` v${batch.config.dataset_version}`
                          : ""}
                      </span>
                    )}
                    <span className="font-mono">{batch.org_slug}</span>
                    <span className="tabular-nums">{formatCount(batch.candidate_count)} candidates</span>
                  </span>
                </Link>
              </TableCell>
              <TableCell>
                <BatchStatusBadge status={batch.status} reason={batch.status_reason} />
              </TableCell>
              <TableCell className="hidden @xl:table-cell">
                <BatchProgress batch={batch} />
              </TableCell>
              <TableCell className="hidden text-right tabular-nums @3xl:table-cell">
                <span className="flex flex-col">
                  <span>{formatCost(batch.cost_usd)}</span>
                  <span className="text-xs text-muted-foreground">est. {formatCost(batch.estimate_usd)}</span>
                </span>
              </TableCell>
              <TableCell className="hidden text-sm text-muted-foreground tabular-nums @4xl:table-cell">
                {formatDateTime(batch.created_at)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
