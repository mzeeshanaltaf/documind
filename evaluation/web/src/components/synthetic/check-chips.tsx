import { CircleAlertIcon, CircleCheckIcon, CircleXIcon } from "lucide-react";
import type { Candidate } from "@/lib/api-types";
import { cn } from "@/lib/utils";
import { checkLabel } from "./labels";

type Tone = "fail" | "warn" | "pass";

type Chip = { tone: Tone; label: string; detail?: string };

const TONE: Record<Tone, { className: string; icon: React.ComponentType<{ className?: string }> }> = {
  fail: { className: "border-destructive/40 text-destructive", icon: CircleXIcon },
  warn: { className: "border-warning/40 text-warning", icon: CircleAlertIcon },
  pass: { className: "text-muted-foreground", icon: CircleCheckIcon },
};

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** The deterministic checks and the validator's verdict as chips: failures, then warnings, then
 * the checks that passed (so a clean candidate still shows what was verified). */
export function checkChips(candidate: Candidate): Chip[] {
  const checks = candidate.checks ?? {};
  const failures = new Set(checks.failures ?? []);
  const warnings = new Set(checks.warnings ?? []);
  const chips: Chip[] = [];
  const detail: Record<string, string | undefined> = {
    copied: checks.overlap != null ? `${pct(checks.overlap)} of the question's word triples are in the source` : undefined,
    overlap: checks.overlap != null ? `${pct(checks.overlap)} of the question's word triples are in the source` : undefined,
    duplicate: checks.duplicate
      ? `${pct(checks.duplicate.score)} like ${checks.duplicate.label}: "${checks.duplicate.question}"`
      : undefined,
    unknown_section: checks.sections
      ? [...checks.sections.unknown_sections, ...checks.sections.malformed, ...checks.sections.unknown_doc_codes]
          .filter(Boolean)
          .join(", ")
      : undefined,
    quotes_not_found: checks.quotes?.missing.join(" · "),
    generation_error: checks.generation_error,
    retrieval_failed: checks.retrieval_error,
    validation_error: checks.validation?.error ?? undefined,
  };
  for (const code of failures) chips.push({ tone: "fail", label: checkLabel(code), detail: detail[code] });
  for (const code of warnings) chips.push({ tone: "warn", label: checkLabel(code), detail: detail[code] });

  const validation = checks.validation;
  if (validation?.status === "ok" && validation.keep && !failures.has("validator_rejected"))
    chips.push({ tone: "pass", label: "Validator: keep", detail: `ambiguity ${validation.ambiguity}` });
  if (checks.sections?.ok && checks.has_sections !== false) chips.push({ tone: "pass", label: "Sections match" });
  if (checks.overlap != null && !failures.has("copied") && !warnings.has("overlap"))
    chips.push({ tone: "pass", label: "Paraphrased", detail: `${pct(checks.overlap)} source overlap` });
  if (checks.duplicate && !failures.has("duplicate"))
    chips.push({ tone: "pass", label: "Not a duplicate", detail: `closest ${pct(checks.duplicate.score)}` });
  if (checks.quotes && checks.quotes.count > 0 && !checks.quotes.missing.length)
    chips.push({ tone: "pass", label: "Quotes found" });
  if (candidate.type === "unanswerable" && checks.retrieval)
    chips.push({
      tone: validation?.answerable_from_sources === false ? "pass" : "warn",
      label: validation?.answerable_from_sources === false ? "Retrieval doesn't answer it" : "Retrieval may answer it",
      detail: checks.retrieval
        .slice(0, 3)
        .map((r) => r.section)
        .filter(Boolean)
        .join(", "),
    });
  return chips;
}

export function CheckChips({ candidate, className }: { candidate: Candidate; className?: string }) {
  const chips = checkChips(candidate);
  if (!chips.length) return null;
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)} aria-label="Checks">
      {chips.map((chip) => {
        const { className: tone, icon: Icon } = TONE[chip.tone];
        return (
          <li
            key={`${chip.tone}-${chip.label}`}
            title={chip.detail}
            className={cn("inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs", tone)}
          >
            <Icon className="size-3.5 shrink-0" aria-hidden />
            <span>{chip.label}</span>
            {chip.detail && <span className="sr-only">: {chip.detail}</span>}
          </li>
        );
      })}
    </ul>
  );
}
