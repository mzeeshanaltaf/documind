import { CircleAlertIcon, CircleCheckIcon, ClockIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { type DocumentRow, isInFlight } from "@/lib/api-types";
import { STAGE_LABELS } from "@/lib/format";

/** Ready / Failed badges; while ingesting, the current stage and a progress bar. */
export function DocumentStatus({ doc }: { doc: Pick<DocumentRow, "status" | "job" | "error" | "indexed_at"> }) {
  if (isInFlight(doc)) {
    const job = doc.job;
    const queued = !job || job.status === "queued";
    const progress = job?.progress ?? 0;
    const label = queued ? "Queued" : (STAGE_LABELS[job?.stage ?? ""] ?? "Processing");
    return (
      <div className="flex w-36 flex-col gap-1.5">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {queued && <ClockIcon className="size-3.5" aria-hidden />}
          <span>{label}</span>
          {!queued && <span className="ml-auto tabular-nums">{progress}%</span>}
        </span>
        <Progress value={queued ? 0 : progress} aria-label={`Ingestion progress: ${label}`} className="gap-0" />
        {doc.indexed_at && <span className="text-[0.7rem] text-muted-foreground">Previous version stays searchable</span>}
      </div>
    );
  }
  if (doc.status === "failed") {
    return (
      <Badge variant="outline" className="gap-1 border-destructive/40 text-destructive" title={doc.error ?? doc.job?.error ?? undefined}>
        <CircleAlertIcon />
        Failed
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-success">
      <CircleCheckIcon />
      Ready
    </Badge>
  );
}
