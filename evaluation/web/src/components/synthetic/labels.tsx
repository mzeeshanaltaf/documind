import { CircleCheckIcon, CircleDashedIcon, CircleXIcon, LoaderIcon, PauseIcon, SearchCheckIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { BatchStatus, Candidate, SyntheticBatch, SyntheticType } from "@/lib/api-types";
import { shortId } from "@/lib/format";
import { cn } from "@/lib/utils";

export const TYPE_LABELS: Record<SyntheticType, string> = {
  single_hop: "Single-hop",
  multi_hop: "Multi-hop",
  jurisdiction: "Jurisdiction",
  comparative: "Comparative",
  unanswerable: "Unanswerable",
  out_of_scope: "Out of scope",
};

export const TYPE_HINTS: Record<SyntheticType, string> = {
  single_hop: "One passage answers it.",
  multi_hop: "Needs two passages together.",
  jurisdiction: "A country supplement refines the company-wide rule.",
  comparative: "The same topic in two countries.",
  unanswerable: "Close to the documents, but they don't cover it.",
  out_of_scope: "Not about company policy at all.",
};

export function typeLabel(type: string): string {
  return TYPE_LABELS[type as SyntheticType] ?? type.replace(/_/g, " ");
}

/** Check codes (`synthetic_checks.verdict`) in reviewer language. */
const CHECK_LABELS: Record<string, string> = {
  generation_error: "Generation failed",
  copied: "Copied wording",
  overlap: "Wording close to the source",
  duplicate: "Duplicate question",
  unknown_section: "Section not in the sources",
  no_sections: "No expected section",
  no_chunks: "No source passages",
  retrieval_failed: "DocuMind retrieval failed",
  validator_rejected: "Validator rejected",
  validation_error: "Validator didn't answer",
  ambiguous: "Somewhat ambiguous",
  quotes_not_found: "Quote not found in source",
};

export function checkLabel(code: string): string {
  return CHECK_LABELS[code] ?? code.replace(/_/g, " ");
}

/** "validator_rejected, duplicate" → readable; a human's free-text reason stays as written. */
export function rejectReasonLabel(candidate: Pick<Candidate, "reject_reason" | "auto_rejected">): string | null {
  if (!candidate.reject_reason) return null;
  if (!candidate.auto_rejected) return candidate.reject_reason;
  return candidate.reject_reason
    .split(",")
    .map((code) => checkLabel(code.trim()))
    .join(", ");
}

export function batchTitle(batch: Pick<SyntheticBatch, "name" | "id" | "kind">): string {
  return batch.name || `${batch.kind === "enrichment" ? "Enrichment" : "Batch"} ${shortId(batch.id)}`;
}

const BATCH: Record<BatchStatus, { label: string; className: string; icon: React.ComponentType<{ className?: string }> }> = {
  generating: { label: "Generating", className: "text-info", icon: LoaderIcon },
  paused: { label: "Paused", className: "text-warning", icon: PauseIcon },
  review: { label: "In review", className: "text-foreground", icon: SearchCheckIcon },
};

const REASONS: Record<string, string> = { budget: "cost cap reached", judge_unavailable: "Anthropic unavailable" };

export function BatchStatusBadge({ status, reason }: { status: BatchStatus; reason?: string | null }) {
  const spec = BATCH[status] ?? BATCH.generating;
  const Icon = spec.icon;
  const why = reason ? (REASONS[reason] ?? reason.replace(/_/g, " ")) : null;
  return (
    <Badge variant="outline" className={cn("gap-1", spec.className)}>
      <Icon className={cn(status === "generating" && "motion-safe:animate-spin")} />
      {spec.label}
      {why && <span className="font-normal text-muted-foreground">· {why}</span>}
    </Badge>
  );
}

/** Review state of one candidate: label + icon, never colour alone. */
export function CandidateStatusMark({ candidate, className }: { candidate: Candidate; className?: string }) {
  if (candidate.gen_status === "queued")
    return (
      <span className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground", className)}>
        <LoaderIcon className="size-3.5 motion-safe:animate-spin" aria-hidden />
        Generating
      </span>
    );
  if (candidate.status === "approved")
    return (
      <span className={cn("inline-flex items-center gap-1 text-xs font-medium text-success", className)}>
        <CircleCheckIcon className="size-3.5" aria-hidden />
        {candidate.case_id ? "Committed" : "Approved"}
      </span>
    );
  if (candidate.status === "rejected")
    return (
      <span className={cn("inline-flex items-center gap-1 text-xs font-medium text-destructive", className)}>
        <CircleXIcon className="size-3.5" aria-hidden />
        {candidate.auto_rejected ? "Auto-rejected" : "Rejected"}
      </span>
    );
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground", className)}>
      <CircleDashedIcon className="size-3.5" aria-hidden />
      Pending
    </span>
  );
}

/** Candidates a decision has been made on (auto-rejections included). */
export function reviewedCount(batch: Pick<SyntheticBatch, "counts">): number {
  return batch.counts.approved + batch.counts.rejected;
}
