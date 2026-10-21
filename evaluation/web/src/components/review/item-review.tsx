"use client";

import { ArrowRightIcon, CircleCheckIcon, CircleDotIcon, CircleXIcon, LockIcon, SkipForwardIcon } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState, useTransition } from "react";
import { submitReview } from "@/app/(app)/review/actions";
import { FormAlert } from "@/components/auth/form-alert";
import { CaseAnswer, type CitedSource } from "@/components/case/answer";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { JudgeView, ReviewGrade, ReviewItem, ReviewMetric, ReviewProgress, Rubric } from "@/lib/api-types";
import { humanize, pageLabel } from "@/lib/format";
import { metricLabel } from "@/lib/metrics";
import { cn } from "@/lib/utils";

type Slot = { id: string; metric: ReviewMetric; claimIdx?: number };
type Submitted = { item: ReviewItem; progress: ReviewProgress };

const VERDICT_TEXT: Record<string, string> = {
  supported: "Supported",
  not_found: "Not found",
  contradicted: "Contradicted",
};

function choiceText(metric: ReviewMetric, choice: string) {
  if (metric.kind === "claims") return VERDICT_TEXT[choice] ?? choice;
  if (metric.kind === "binary") return humanize(choice);
  return /^\d$/.test(choice) ? choice : humanize(choice);
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || !!target.closest("[role=listbox],[role=menu],[role=dialog]");
}

/** Display order: rubric scores and verdicts best first (as the prompt lists them). */
function displayChoices(metric: ReviewMetric) {
  return metric.kind === "ordinal" ? [...metric.choices].reverse() : metric.choices;
}

function slotsOf(item: ReviewItem): Slot[] {
  return item.metrics.flatMap((metric) =>
    metric.kind === "claims"
      ? item.claims.map((c) => ({ id: `${metric.key}:${c.idx}`, metric, claimIdx: c.idx }))
      : [{ id: metric.key, metric }],
  );
}

/** Grade one case: the judge's packet on the left, the rubric on the right; the judge's own grades
 * appear (in a blind queue) once yours are in. */
export function ItemReview({
  item,
  blind,
  busy,
  onSubmitted,
  onNext,
  onSkip,
}: {
  item: ReviewItem;
  blind: boolean;
  busy: boolean;
  onSubmitted: (result: Submitted) => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const uid = useId();
  const slots = useMemo(() => slotsOf(item), [item]);
  const submitted = Object.keys(item.mine).length > 0;
  const editable = !item.locked;

  const [labels, setLabels] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(
      Object.values(item.mine)
        .filter((r) => r.metric !== "faithfulness")
        .map((r) => [r.metric, r.label]),
    ),
  );
  const [claims, setClaims] = useState<Record<string, string>>(() => ({ ...(item.mine.faithfulness?.claim_verdicts ?? {}) }));
  const [claimsNa, setClaimsNa] = useState(() => !!item.mine.faithfulness && !item.mine.faithfulness.claim_verdicts);
  const [note, setNote] = useState(() => Object.values(item.mine).find((r) => r.comment)?.comment ?? "");
  const [dirty, setDirty] = useState(false);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const filled = useCallback(
    (slot: Slot) => (slot.metric.kind === "claims" ? claimsNa || !!claims[String(slot.claimIdx)] : slot.id in labels),
    [claims, claimsNa, labels],
  );
  const complete = slots.every(filled);

  const choose = useCallback(
    (slot: Slot, choice: string | null) => {
      if (!editable) return;
      setDirty(true);
      setError(null);
      if (slot.metric.kind === "claims") {
        if (choice === null) setClaimsNa(true);
        else {
          setClaimsNa(false);
          setClaims((c) => ({ ...c, [String(slot.claimIdx)]: choice }));
        }
      } else setLabels((l) => ({ ...l, [slot.id]: choice }));
    },
    [editable],
  );

  const focusSlot = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(slots.length - 1, index));
      setActive(clamped);
      const id = slots[clamped]?.id;
      if (id) document.querySelector(`[data-review-slot="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    },
    [slots],
  );

  const submit = useCallback(() => {
    if (!complete) {
      setError("Grade every metric (or mark it not applicable) before submitting.");
      return;
    }
    const comment = note.trim() || null;
    const grades: ReviewGrade[] = item.metrics.map((metric) =>
      metric.kind === "claims"
        ? claimsNa
          ? { metric: metric.key, label: null, comment }
          : { metric: metric.key, claim_verdicts: claims, comment }
        : { metric: metric.key, label: labels[metric.key] ?? null, comment },
    );
    setError(null);
    startSaving(async () => {
      const result = await submitReview(item.queue_id, item.id, grades);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDirty(false);
      onSubmitted(result.data);
    });
  }, [claims, claimsNa, complete, item, labels, note, onSubmitted]);

  const advance = useCallback(() => {
    if (editable && (!submitted || dirty)) submit();
    else onNext();
  }, [dirty, editable, onNext, submit, submitted]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || saving || busy) return;
      const slot = slots[active];
      if (/^[0-9]$/.test(e.key) && slot && editable) {
        const digit = Number(e.key);
        if (digit === 0) choose(slot, null);
        else if (digit <= slot.metric.choices.length) choose(slot, slot.metric.choices[digit - 1]);
        else return;
        // On to the next slot still to grade (or simply the next one).
        const after = slots.findIndex((s, i) => i > active && !filled(s) && s.id !== slot.id);
        focusSlot(after >= 0 ? after : Math.min(active + 1, slots.length - 1));
      } else if (e.key === "ArrowDown") focusSlot(active + 1);
      else if (e.key === "ArrowUp") focusSlot(active - 1);
      else if (e.key === "n") advance();
      else if (e.key === "s" && !submitted) onSkip();
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, advance, busy, choose, editable, filled, focusSlot, onSkip, saving, slots, submitted]);

  const sources = useMemo<Record<number, CitedSource>>(
    () => Object.fromEntries(item.packet.sources.map((s) => [s.n, { ...s, quotes: [] }])),
    [item.packet.sources],
  );

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-10">
      <CasePacket item={item} sources={sources} />

      <section aria-label="Your grades" className="flex flex-col gap-5 lg:sticky lg:top-6 lg:max-h-[calc(100svh-3rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            <kbd className="font-mono">1</kbd>–<kbd className="font-mono">5</kbd> grade · <kbd className="font-mono">0</kbd> n/a ·{" "}
            <kbd className="font-mono">↑</kbd>/<kbd className="font-mono">↓</kbd> move · <kbd className="font-mono">n</kbd>{" "}
            {editable && (!submitted || dirty) ? "submit" : "next"}
            {!submitted && (
              <>
                {" "}
                · <kbd className="font-mono">s</kbd> skip
              </>
            )}
          </span>
          {item.locked && (
            <span className="inline-flex items-center gap-1">
              <LockIcon className="size-3.5" aria-hidden />
              Locked: you&apos;ve seen the judge
            </span>
          )}
        </div>
        <FormAlert message={error} />

        {item.metrics.map((metric) => (
          <MetricGrader
            key={metric.key}
            item={item}
            metric={metric}
            rubric={item.rubrics[metric.key]}
            judge={item.judge?.[metric.key] ?? null}
            slots={slots}
            active={active}
            labels={labels}
            claims={claims}
            claimsNa={claimsNa}
            editable={editable}
            onActivate={setActive}
            onChoose={choose}
          />
        ))}

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${uid}-note`} className="text-sm font-medium">
            Note <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <Textarea
            id={`${uid}-note`}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setDirty(true);
            }}
            disabled={!editable}
            rows={2}
            maxLength={4000}
            placeholder="Why you graded it this way, or what the rubric doesn't cover."
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
          {!submitted ? (
            <Button variant="ghost" onClick={onSkip} disabled={busy || saving}>
              <SkipForwardIcon data-icon="inline-start" />
              Skip
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">
              {blind ? "Graded. The judge's grades are shown with yours." : "Graded."}
            </span>
          )}
          {editable && (!submitted || dirty) ? (
            <Button onClick={submit} disabled={saving || busy || !complete}>
              {saving && <Spinner data-icon="inline-start" />}
              {saving ? "Saving…" : blind && !submitted ? "Submit and reveal" : "Save grades"}
            </Button>
          ) : (
            <Button onClick={onNext} disabled={busy}>
              {busy ? <Spinner data-icon="inline-start" /> : null}
              Next case
              {!busy && <ArrowRightIcon data-icon="inline-end" />}
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}

function Block({ title, hint, children }: { title: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="font-sans text-sm font-semibold">{title}</h2>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </header>
      {children}
    </section>
  );
}

/** Exactly what the judge read for this case, in its order. */
function CasePacket({ item, sources }: { item: ReviewItem; sources: Record<number, CitedSource> }) {
  const p = item.packet;
  const hasReference = !!p.reference_answer || p.key_facts.length > 0;
  return (
    <div className="flex min-w-0 flex-col gap-7">
      <div className="flex flex-col gap-2">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="font-mono">#{item.position}</span>
          <span className="font-mono">{item.case_key}</span>
          <span>{humanize(item.case_type)}</span>
        </p>
        <p className="font-heading text-lg leading-snug font-semibold text-pretty">{p.question}</p>
        <p className="text-sm text-muted-foreground">
          Expected to <span className="text-foreground">{p.expected_behavior_text || humanize(p.expected_behavior)}</span>.
        </p>
      </div>

      {p.conversation.length > 0 && (
        <Block title="Earlier in the conversation">
          <ol className="flex flex-col gap-2 text-sm">
            {p.conversation.map((turn, i) => (
              <li key={i} className={cn("rounded-lg px-3 py-2", turn.role === "user" ? "bg-muted" : "border")}>
                <span className="mb-0.5 block text-[0.7rem] text-muted-foreground">{turn.role === "user" ? "User" : "DocuMind"}</span>
                <span className="whitespace-pre-line">{turn.content}</span>
              </li>
            ))}
          </ol>
        </Block>
      )}

      {p.standalone_query && item.metrics.some((m) => m.key === "followup_resolution") && (
        <Block title="Standalone query" hint="DocuMind's rewrite of the follow-up, before retrieval">
          <p className="rounded-lg border px-3 py-2 font-mono text-xs">{p.standalone_query}</p>
        </Block>
      )}

      <Block title="Answer">
        <CaseAnswer answer={p.answer} sources={sources} />
      </Block>

      {hasReference && (
        <Block title="Reference" hint="What correctness is graded against">
          {p.reference_answer && <p className="max-w-[72ch] text-sm leading-relaxed whitespace-pre-line">{p.reference_answer}</p>}
          {p.key_facts.length > 0 && (
            <ol className="flex max-w-[72ch] list-decimal flex-col gap-1 pl-5 text-sm">
              {p.key_facts.map((f, i) => (
                <li key={i}>
                  {f.fact}
                  {f.weight !== 1 && <span className="ml-1.5 font-mono text-[0.7rem] text-muted-foreground">×{f.weight}</span>}
                </li>
              ))}
            </ol>
          )}
        </Block>
      )}

      <Block title={`Sources (${p.sources.length})`} hint="Numbered as DocuMind numbered them">
        {p.sources.length ? (
          <ol className="flex flex-col divide-y rounded-lg border">
            {p.sources.map((s) => (
              <li key={s.n}>
                <details className="group">
                  <summary className="flex cursor-pointer items-baseline gap-2 px-3 py-2 text-sm hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                    <span className="font-mono text-xs text-muted-foreground">[{s.n}]</span>
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-mono text-xs">{s.doc_code}</span>
                      {s.section_number && <span className="ml-1.5 font-mono text-xs text-muted-foreground">§{s.section_number}</span>}
                      {s.section_title && <span className="ml-1.5">{s.section_title}</span>}
                    </span>
                    <span className="shrink-0 font-mono text-[0.7rem] text-muted-foreground">{pageLabel(s.page_start, s.page_end)}</span>
                  </summary>
                  <div className="flex flex-col gap-1.5 px-3 pt-1 pb-3">
                    <p className="font-mono text-[0.7rem] text-muted-foreground">{s.header}</p>
                    <p className="max-w-[72ch] font-heading text-[0.8125rem] leading-relaxed whitespace-pre-line">{s.text}</p>
                  </div>
                </details>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">DocuMind retrieved no sources for this case.</p>
        )}
      </Block>
    </div>
  );
}

function OptionButton({
  selected,
  keyHint,
  onClick,
  disabled,
  children,
  className,
}: {
  selected: boolean;
  keyHint?: string;
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-md border px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-default disabled:hover:bg-transparent",
        selected && "border-primary bg-accent text-accent-foreground hover:bg-accent",
        className,
      )}
    >
      {keyHint && (
        <kbd
          className={cn(
            "mt-px flex size-5 shrink-0 items-center justify-center rounded border font-mono text-[0.7rem] text-muted-foreground",
            selected && "border-primary text-foreground",
          )}
        >
          {keyHint}
        </kbd>
      )}
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}

function anchorFor(rubric: Rubric | undefined, label: string) {
  return rubric?.groups[0]?.anchors.find((a) => a.label === label)?.text;
}

/** For a rubric score without its own anchor (the even ones): between which anchors it sits. */
function betweenAnchors(rubric: Rubric | undefined, choice: string, choices: string[]) {
  const value = Number(choice);
  const scored = choices.map(Number).filter((c) => anchorFor(rubric, String(c)));
  const above = Math.min(...scored.filter((c) => c > value));
  const below = Math.max(...scored.filter((c) => c < value));
  return Number.isFinite(above) && Number.isFinite(below) ? `Between ${above} and ${below}.` : undefined;
}

/** Rubric prose as written in the prompt: `code` spans in mono, first letter capitalised. */
function RubricText({ text }: { text: string }) {
  const parts = text.replace(/^\p{Ll}/u, (c) => c.toUpperCase()).split(/`([^`]+)`/);
  return parts.map((part, i) =>
    i % 2 ? (
      <code key={i} className="font-mono text-[0.95em]">
        {part}
      </code>
    ) : (
      part
    ),
  );
}

/** `steps` = how many categories apart the two grades are; one step is "close" on ordinal scales. */
function Agreement({ steps, ordinal }: { steps: number | null; ordinal: boolean }) {
  if (steps === null) return null;
  const [label, Icon, tone] =
    steps === 0
      ? ["Agree", CircleCheckIcon, "text-success"]
      : ordinal && steps === 1
        ? ["One step apart", CircleDotIcon, "text-warning"]
        : ["Disagree", CircleXIcon, "text-destructive"];
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", tone)}>
      <Icon className="size-3.5" aria-hidden />
      {label}
    </span>
  );
}

function MetricGrader({
  item,
  metric,
  rubric,
  judge,
  slots,
  active,
  labels,
  claims,
  claimsNa,
  editable,
  onActivate,
  onChoose,
}: {
  item: ReviewItem;
  metric: ReviewMetric;
  rubric: Rubric | undefined;
  judge: JudgeView | null;
  slots: Slot[];
  active: number;
  labels: Record<string, string | null>;
  claims: Record<string, string>;
  claimsNa: boolean;
  editable: boolean;
  onActivate: (index: number) => void;
  onChoose: (slot: Slot, choice: string | null) => void;
}) {
  const group = rubric?.groups[0];
  const mine = item.mine[metric.key];
  const activeSlot = slots[active];
  const isActive = activeSlot?.metric.key === metric.key;

  if (metric.kind === "claims") {
    return (
      <section className={cn("flex flex-col gap-3 rounded-lg border p-3.5", isActive && "border-primary/60")}>
        <MetricHeader metric={metric} rubric={rubric} />
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground">Verdicts, as the judge defines them</summary>
          <ul className="mt-1.5 flex flex-col gap-1">
            {(group?.anchors ?? []).map((a) => (
              <li key={a.label}>
                <span className="font-medium text-foreground">{VERDICT_TEXT[a.label] ?? a.label}:</span> <RubricText text={a.text} />
              </li>
            ))}
          </ul>
        </details>
        {item.claims.length === 0 && <p className="text-sm text-muted-foreground">The judge found no claims to check.</p>}
        <ol className="flex flex-col gap-3">
          {item.claims.map((claim) => {
            const index = slots.findIndex((s) => s.id === `${metric.key}:${claim.idx}`);
            const slot = slots[index];
            const picked = claims[String(claim.idx)];
            const judged = judge?.claims?.find((c) => c.idx === claim.idx);
            return (
              <li
                key={claim.idx}
                data-review-slot={slot.id}
                onClick={() => onActivate(index)}
                className={cn("flex flex-col gap-2 rounded-md p-2", active === index && "bg-muted/60 ring-1 ring-primary/50")}
              >
                <p className="text-sm">
                  <span className="mr-1.5 font-mono text-xs text-muted-foreground">{claim.idx}.</span>
                  {claim.text}
                  {claim.citation_ns.map((n) => (
                    <span key={n} className="ml-1 rounded bg-accent px-1 font-mono text-[0.7rem] text-accent-foreground">
                      {n}
                    </span>
                  ))}
                </p>
                <div role="radiogroup" aria-label={`Claim ${claim.idx}`} className="grid grid-cols-3 gap-1.5">
                  {metric.choices.map((choice, i) => (
                    <OptionButton
                      key={choice}
                      selected={!claimsNa && picked === choice}
                      keyHint={String(i + 1)}
                      disabled={!editable}
                      onClick={() => onChoose(slot, choice)}
                      className="items-center py-1.5 text-xs"
                    >
                      {VERDICT_TEXT[choice]}
                    </OptionButton>
                  ))}
                </div>
                {judged && (
                  <div className="flex flex-col gap-1 border-t pt-2 text-xs">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-muted-foreground">Judge:</span>
                      <span className="font-medium">{VERDICT_TEXT[judged.verdict ?? ""] ?? "no verdict"}</span>
                      {picked && <Agreement steps={picked === judged.verdict ? 0 : 1} ordinal={false} />}
                    </span>
                    {judged.reasoning && <span className="text-muted-foreground">{judged.reasoning}</span>}
                    {judged.evidence_quote && (
                      <span className="font-heading">
                        <mark className="rounded-[3px] bg-highlight px-0.5 text-highlight-foreground">{judged.evidence_quote}</mark>
                        {judged.supporting_ns.length > 0 && (
                          <span className="ml-1 font-mono text-[0.7rem] text-muted-foreground">[{judged.supporting_ns.join(", ")}]</span>
                        )}
                      </span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        {item.claims.length > 0 && (
          <NaButton selected={claimsNa} disabled={!editable} onClick={() => onChoose(slots[slots.findIndex((s) => s.metric.key === metric.key)], null)} />
        )}
        {judge && mine && (
          <div className="border-t pt-2.5 text-xs">
            <MineSummary mine={mine.value} judge={judge.value} metric={metric} />
          </div>
        )}
      </section>
    );
  }

  const index = slots.findIndex((s) => s.id === metric.key);
  const slot = slots[index];
  const picked = labels[metric.key];
  const verdictRule = metric.key === "answer_quality" ? group?.anchors[0]?.text : undefined;
  const judgeChoice = metric.kind === "binary" ? judge?.choice : judge?.label;

  return (
    <section
      data-review-slot={metric.key}
      onClick={() => onActivate(index)}
      className={cn("flex flex-col gap-3 rounded-lg border p-3.5", active === index && "border-primary/60 ring-1 ring-primary/30")}
    >
      <MetricHeader metric={metric} rubric={rubric} />
      {metric.kind === "binary" && (
        <p className="text-xs text-muted-foreground">
          Pick how DocuMind responded. It counts as correct when the case expects that: here, to{" "}
          {item.packet.expected_behavior_text || humanize(item.packet.expected_behavior)}.
        </p>
      )}
      <div role="radiogroup" aria-label={metricLabel(metric.key)} className="flex flex-col gap-1.5">
        {displayChoices(metric).map((choice) => {
          const key = String(metric.choices.indexOf(choice) + 1);
          const text =
            metric.kind === "ordinal" && /^\d$/.test(choice)
              ? (anchorFor(rubric, choice) ?? betweenAnchors(rubric, choice, metric.choices))
              : anchorFor(rubric, choice);
          return (
            <OptionButton key={choice} selected={picked === choice} keyHint={key} disabled={!editable} onClick={() => onChoose(slot, choice)}>
              <span className="flex flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className={cn("font-medium", /^\d$/.test(choice) && "font-mono")}>{choiceText(metric, choice)}</span>
                  {judge && judgeChoice === choice && <span className="text-[0.7rem] font-medium text-primary">Judge</span>}
                </span>
                {text && (
                  <span className="text-xs leading-snug text-muted-foreground">
                    <RubricText text={text} />
                  </span>
                )}
              </span>
            </OptionButton>
          );
        })}
      </div>
      {verdictRule && (
        <p className="text-xs leading-snug text-muted-foreground">
          <RubricText text={verdictRule} />
        </p>
      )}
      <NaButton selected={picked === null} disabled={!editable} onClick={() => onChoose(slot, null)} />
      {judge && mine && (
        <div className="flex flex-col gap-1.5 border-t pt-2.5 text-xs">
          <MineSummary mine={mine.value} judge={judge.value} metric={metric} judgeText={judgeChoice ? choiceText(metric, judgeChoice) : null} />
          {typeof judge.reasoning === "string" && judge.reasoning && <p className="leading-snug text-muted-foreground">{judge.reasoning}</p>}
          {judge.samples && judge.samples.length > 1 && (
            <p className="text-muted-foreground">
              Samples: <span className="font-mono">{judge.samples.join(", ")}</span>
            </p>
          )}
          {judge.issues && judge.issues.length > 0 && (
            <ul className="flex flex-col gap-1">
              {judge.issues.map((issue, i) => (
                <li key={i} className="text-muted-foreground">
                  <span className="font-medium text-foreground">{humanize(issue.severity)}</span> ({humanize(issue.dimension)}):{" "}
                  {issue.explanation}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function MetricHeader({ metric, rubric }: { metric: ReviewMetric; rubric: Rubric | undefined }) {
  const group = rubric?.groups[0];
  const notes = metric.kind === "ordinal" && /^\d$/.test(metric.choices[0]) ? (rubric?.notes ?? []) : [];
  return (
    <header className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="font-sans text-sm font-semibold">{metricLabel(metric.key)}</h3>
        {rubric?.prompt_version != null && (
          <span className="font-mono text-[0.7rem] text-muted-foreground">
            {rubric.prompt} v{rubric.prompt_version}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        <RubricText text={group?.description || metric.description} />
      </p>
      {notes
        .filter((n) => n.toLowerCase().includes("even scores"))
        .map((n) => (
          <p key={n} className="text-xs text-muted-foreground">
            {n}
          </p>
        ))}
    </header>
  );
}

function NaButton({ selected, disabled, onClick }: { selected: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "w-fit rounded-sm text-xs text-muted-foreground hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:no-underline",
        selected && "font-medium text-foreground",
      )}
    >
      <kbd className="mr-1 font-mono">0</kbd>
      {selected ? "Marked not applicable" : "Not applicable"}
    </button>
  );
}

function MineSummary({
  mine,
  judge,
  metric,
  judgeText,
}: {
  mine: number | null;
  judge: number | null;
  metric: ReviewMetric;
  judgeText?: string | null;
}) {
  const fmt = (v: number | null) =>
    v === null ? "n/a" : metric.kind === "claims" ? `${Math.round(v * 100)}% supported` : metric.kind === "binary" ? (v >= 0.5 ? "correct" : "incorrect") : null;
  // Values are on the metric's 0–1 scale: (K − 1) · value is the category.
  const category = (v: number) => Math.round(v * (metric.labels.length - 1));
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span>
        <span className="text-muted-foreground">Judge: </span>
        <span className="font-medium">{judgeText ?? fmt(judge)}</span>
        {metric.kind !== "ordinal" && judgeText && <span className="text-muted-foreground"> ({fmt(judge)})</span>}
      </span>
      {mine === null ? (
        <span className="text-muted-foreground">You marked it not applicable</span>
      ) : (
        <Agreement
          steps={judge === null || metric.kind === "claims" ? null : Math.abs(category(mine) - category(judge))}
          ordinal={metric.kind === "ordinal"}
        />
      )}
    </span>
  );
}
