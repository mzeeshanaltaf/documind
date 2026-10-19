import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleMinusIcon,
  CircleXIcon,
  LoaderIcon,
  PauseIcon,
  SquareIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { RunCaseStatus, RunStatus } from "@/lib/api-types";
import { cn } from "@/lib/utils";

type Tone = "active" | "warning" | "muted" | "success" | "danger";

const TONE_CLASS: Record<Tone, string> = {
  active: "text-info",
  warning: "text-warning",
  muted: "text-muted-foreground",
  success: "text-success",
  danger: "border-destructive/40 text-destructive",
};

const RUN: Record<RunStatus, { label: string; tone: Tone; icon: React.ComponentType<{ className?: string }> }> = {
  running: { label: "Running", tone: "active", icon: LoaderIcon },
  pausing: { label: "Pausing", tone: "warning", icon: PauseIcon },
  paused: { label: "Paused", tone: "warning", icon: PauseIcon },
  stopping: { label: "Stopping", tone: "muted", icon: SquareIcon },
  stopped: { label: "Stopped", tone: "muted", icon: SquareIcon },
  finalizing: { label: "Finalizing", tone: "active", icon: LoaderIcon },
  completed: { label: "Completed", tone: "success", icon: CircleCheckIcon },
  failed: { label: "Failed", tone: "danger", icon: CircleAlertIcon },
};

const REASONS: Record<string, string> = {
  budget: "judge budget reached",
  judge_unavailable: "judge unavailable",
};

export function runReasonLabel(reason: string | null | undefined): string | null {
  return reason ? (REASONS[reason] ?? reason.replace(/_/g, " ")) : null;
}

export function RunStatusBadge({ status, reason }: { status: RunStatus; reason?: string | null }) {
  const spec = RUN[status] ?? RUN.running;
  const Icon = spec.icon;
  const why = runReasonLabel(reason);
  const spinning = status === "running" || status === "finalizing";
  return (
    <Badge variant="outline" className={cn("gap-1", TONE_CLASS[spec.tone])} title={why ?? undefined}>
      <Icon className={cn(spinning && "motion-safe:animate-spin")} />
      {spec.label}
      {why && <span className="font-normal text-muted-foreground">· {why}</span>}
    </Badge>
  );
}

const CASE: Record<RunCaseStatus, { label: string; tone: Tone; icon: React.ComponentType<{ className?: string }> }> = {
  pending: { label: "Queued", tone: "muted", icon: CircleDashedIcon },
  generating: { label: "Asking", tone: "active", icon: LoaderIcon },
  generated: { label: "Answered", tone: "active", icon: CircleDashedIcon },
  judging: { label: "Judging", tone: "active", icon: LoaderIcon },
  done: { label: "Done", tone: "muted", icon: CircleCheckIcon },
  error: { label: "Error", tone: "danger", icon: CircleAlertIcon },
  skipped: { label: "Skipped", tone: "muted", icon: CircleMinusIcon },
};

export function CaseStatusBadge({ status }: { status: RunCaseStatus }) {
  const spec = CASE[status] ?? CASE.pending;
  const Icon = spec.icon;
  const spinning = status === "generating" || status === "judging";
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", TONE_CLASS[spec.tone])}>
      <Icon className={cn("size-3.5", spinning && "motion-safe:animate-spin")} aria-hidden />
      {spec.label}
    </span>
  );
}

/** Pass/fail of a finished case (null while it runs or when it errored). */
export function PassMark({ passed, className }: { passed: boolean | null | undefined; className?: string }) {
  if (passed === null || passed === undefined) return <span className={cn("text-xs text-muted-foreground", className)}>n/a</span>;
  return passed ? (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium text-success", className)}>
      <CircleCheckIcon className="size-3.5" aria-hidden />
      Pass
    </span>
  ) : (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium text-destructive", className)}>
      <CircleXIcon className="size-3.5" aria-hidden />
      Fail
    </span>
  );
}
