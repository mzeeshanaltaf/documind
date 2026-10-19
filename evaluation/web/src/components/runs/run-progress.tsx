import { Progress } from "@/components/ui/progress";
import type { RunOut } from "@/lib/api-types";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

type Counts = Pick<RunOut, "total_cases" | "done_cases" | "failed_cases" | "skipped_cases" | "passed_cases">;

export function finishedCases(run: Counts): number {
  return run.done_cases + run.failed_cases + run.skipped_cases;
}

/** Bar = finished / total; the line underneath says what "finished" was made of. */
export function RunProgress({ run, compact = false, className }: { run: Counts; compact?: boolean; className?: string }) {
  const finished = finishedCases(run);
  const pct = run.total_cases ? Math.round((finished / run.total_cases) * 100) : 0;
  return (
    <div className={cn("flex min-w-28 flex-col gap-1.5", className)}>
      <Progress value={pct} aria-label={`${finished} of ${run.total_cases} cases finished`} className="gap-0" />
      <span className="text-xs text-muted-foreground tabular-nums">
        {formatCount(finished)}/{formatCount(run.total_cases)}
        {!compact && (
          <>
            {" "}
            · {formatCount(run.passed_cases)} passed
            {run.failed_cases > 0 && <> · {formatCount(run.failed_cases)} errors</>}
            {run.skipped_cases > 0 && <> · {formatCount(run.skipped_cases)} skipped</>}
          </>
        )}
      </span>
    </div>
  );
}
