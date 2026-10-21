import { EyeOffIcon } from "lucide-react";
import Link from "next/link";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ReviewProgress, ReviewQueue } from "@/lib/api-types";
import { formatDateTime, shortId } from "@/lib/format";
import { metricLabel } from "@/lib/metrics";

export const SAMPLING_LABELS: Record<string, string> = {
  stratified: "Stratified",
  random: "Random",
  disagreement: "Disagreement",
};

/** This reviewer's progress through a queue. */
export function QueueProgress({ progress }: { progress: ReviewProgress | null }) {
  if (!progress) return null;
  const handled = progress.mine_done + progress.mine_skipped;
  const pct = progress.total ? Math.round((progress.mine_done / progress.total) * 100) : 0;
  return (
    <div className="flex min-w-32 flex-col gap-1.5">
      <Progress value={pct} aria-label={`${progress.mine_done} of ${progress.total} cases graded by you`} className="gap-0" />
      <span className="text-xs text-muted-foreground tabular-nums">
        {progress.mine_done}/{progress.total} graded
        {progress.mine_skipped > 0 && <> · {progress.mine_skipped} skipped</>}
        {handled === progress.total && progress.total > 0 && <> · finished</>}
        {progress.double_graded > 0 && <> · {progress.double_graded} by two reviewers</>}
      </span>
    </div>
  );
}

export function QueuesTable({ queues }: { queues: ReviewQueue[] }) {
  return (
    <div className="@container overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Queue</TableHead>
            <TableHead className="hidden @xl:table-cell">Your progress</TableHead>
            <TableHead className="hidden @3xl:table-cell">Run</TableHead>
            <TableHead className="hidden @4xl:table-cell">Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {queues.map((queue) => (
            <TableRow key={queue.id}>
              <TableCell className="max-w-0 min-w-48 @xl:max-w-none">
                <Link
                  href={`/review/${queue.id}`}
                  className="flex min-w-0 flex-col gap-0.5 rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <span className="truncate font-medium hover:underline">{queue.name}</span>
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    <span>{queue.metrics.map(metricLabel).join(", ")}</span>
                    <span>{SAMPLING_LABELS[queue.sampling] ?? queue.sampling}</span>
                    {queue.blind && (
                      <span className="inline-flex items-center gap-1">
                        <EyeOffIcon className="size-3" aria-hidden />
                        Blind
                      </span>
                    )}
                  </span>
                </Link>
              </TableCell>
              <TableCell className="hidden @xl:table-cell">
                <QueueProgress progress={queue.progress} />
              </TableCell>
              <TableCell className="hidden @3xl:table-cell">
                <Link href={`/runs/${queue.run_id}`} className="text-sm hover:underline">
                  {queue.run_name ?? <span className="font-mono text-xs">{shortId(queue.run_id)}</span>}
                </Link>
              </TableCell>
              <TableCell className="hidden text-sm text-muted-foreground tabular-nums @4xl:table-cell">
                {formatDateTime(queue.created_at)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
