import { CircleAlertIcon, CircleCheckIcon, CircleDashedIcon, CircleDotIcon, HistoryIcon } from "lucide-react";
import Link from "next/link";
import type { CalibrationBadge as Badge, CalibrationStatus } from "@/lib/api-types";
import { metricLabel } from "@/lib/metrics";
import { cn } from "@/lib/utils";

export const STATUS: Record<
  CalibrationStatus,
  { label: string; tone: string; icon: React.ComponentType<{ className?: string }>; meaning: string }
> = {
  calibrated: {
    label: "Calibrated",
    tone: "text-success",
    icon: CircleCheckIcon,
    meaning: "The judge agrees with human reviewers (κw ≥ 0.6 over 30 or more graded cases).",
  },
  moderate: {
    label: "Moderate",
    tone: "text-info",
    icon: CircleDotIcon,
    meaning: "Fair agreement with human reviewers (κw 0.4 to 0.6, or fewer than 30 graded cases).",
  },
  unreliable: {
    label: "Unreliable",
    tone: "text-destructive",
    icon: CircleAlertIcon,
    meaning: "The judge agrees poorly with human reviewers (κw below 0.4).",
  },
  stale: {
    label: "Stale",
    tone: "text-warning",
    icon: HistoryIcon,
    meaning: "Calibrated for another prompt version or judge model than this one.",
  },
  uncalibrated: {
    label: "Uncalibrated",
    tone: "text-muted-foreground",
    icon: CircleDashedIcon,
    meaning: "Fewer than 20 human-graded cases for this prompt version and model.",
  },
};

export function kappaLabel(primary: string | null | undefined): string {
  return primary === "kappa" ? "κ" : "κw";
}

export function formatKappa(value: number | null | undefined): string {
  if (value === null || value === undefined) return "n/a";
  return value.toFixed(2).replace("-", "−");
}

export function calibrationAnchor(metric: string): string {
  return `cal-${metric.replace(/[^a-z0-9]+/gi, "-")}`;
}

/** A judge metric's calibration status: icon + label (never colour alone), links to /calibration. */
export function CalibrationBadge({ badge, className, compact = false }: { badge: Badge; className?: string; compact?: boolean }) {
  const spec = STATUS[badge.status] ?? STATUS.uncalibrated;
  const Icon = spec.icon;
  const detail =
    badge.status === "stale" && badge.latest
      ? `calibrated for prompt v${badge.latest.prompt_version} · ${badge.latest.judge_model}`
      : badge.n > 0
        ? `${kappaLabel(badge.primary)} ${formatKappa(badge.kappa)} · n ${badge.n}`
        : null;
  const title = [
    `${metricLabel(badge.metric)}: ${spec.label}.`,
    badge.reviewable ? spec.meaning : "People can't grade this metric yet, so it has no calibration.",
    detail,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <Link
      href={`/calibration#${calibrationAnchor(badge.metric)}`}
      title={title}
      className={cn(
        "inline-flex w-fit items-center gap-1 rounded-sm text-[0.7rem] leading-none whitespace-nowrap hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        spec.tone,
        className,
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      {spec.label}
      {!compact && badge.n > 0 && badge.status !== "stale" && (
        <span className="font-mono text-muted-foreground tabular-nums">
          {badge.kappa === null ? `n ${badge.n}` : `${kappaLabel(badge.primary)} ${formatKappa(badge.kappa)}`}
        </span>
      )}
    </Link>
  );
}

/** The caution line a run shows under its metrics for unreliable or stale judge metrics. */
export function CalibrationCautions({ badges, runId }: { badges: Badge[]; runId: string }) {
  const flagged = badges.filter((b) => b.status === "unreliable" || b.status === "stale");
  if (!flagged.length) return null;
  return (
    <ul className="flex flex-col gap-1.5 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm">
      {flagged.map((b) => (
        <li key={b.metric} className="flex gap-2">
          <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <span className="max-w-[80ch] text-pretty">
            <span className="font-medium">{metricLabel(b.metric)}:</span>{" "}
            {b.status === "unreliable" ? (
              <>
                the judge agrees poorly with human reviewers ({kappaLabel(b.primary)} {formatKappa(b.kappa)}, n {b.n}).
                Read its scores with caution.
              </>
            ) : (
              <>
                calibrated for prompt v{b.latest?.prompt_version} ({b.latest?.judge_model}), but this run used v
                {b.prompt_version ?? "?"} ({b.judge_model}). Its human agreement is unknown until a sample is regraded.
              </>
            )}{" "}
            <Link href={`/review/new?run=${runId}&metric=${encodeURIComponent(b.metric)}`} className="text-primary hover:underline">
              Grade a sample
            </Link>
          </span>
        </li>
      ))}
    </ul>
  );
}
