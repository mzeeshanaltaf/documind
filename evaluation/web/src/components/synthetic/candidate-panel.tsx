"use client";

import { CircleXIcon, PencilIcon, PlusIcon, RotateCcwIcon, TrashIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { OptionSelect } from "@/components/app/option-select";
import { FormAlert } from "@/components/auth/form-alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { type Candidate, type CandidatePatch, EXPECTED_BEHAVIORS, type KeyFact } from "@/lib/api-types";
import { humanize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CheckChips } from "./check-chips";
import { CandidateStatusMark, rejectReasonLabel, typeLabel } from "./labels";

export type PanelMode = "view" | "edit" | "reject";

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="ml-1.5 hidden rounded border border-current/25 px-1 font-mono text-[0.65rem] leading-4 opacity-70 sm:inline-block">
      {children}
    </kbd>
  );
}

const QUICK_REASONS = ["Vague question", "Wrong or incomplete answer", "Unrealistic for an employee", "Too close to the text", "Not what the type asks for"];

function pagesText(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value
    .map((p) => {
      const item = p as { doc_code?: string; page_start?: number; page_end?: number };
      const pages = item.page_end && item.page_end !== item.page_start ? `${item.page_start}-${item.page_end}` : `${item.page_start}`;
      return item.doc_code ? `${item.doc_code} p.${pages}` : `p.${pages}`;
    })
    .join(", ");
}

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-1.5", className)}>
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

export function CandidatePanel({
  candidate,
  mode,
  busy,
  error,
  onMode,
  onApprove,
  onReject,
  onRestore,
  onSave,
}: {
  candidate: Candidate;
  mode: PanelMode;
  busy: boolean;
  error: string | null;
  onMode: (mode: PanelMode) => void;
  onApprove: () => void;
  onReject: (reason: string | null) => void;
  onRestore: () => void;
  onSave: (patch: CandidatePatch) => void;
}) {
  const committed = !!candidate.case_id;
  const generated = candidate.gen_status === "generated";
  const enrichment = !!candidate.target_case_key;
  const validation = candidate.checks?.validation;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="font-mono text-xs text-muted-foreground">#{String(candidate.ordinal).padStart(3, "0")}</span>
          <Badge variant="secondary">{typeLabel(candidate.type)}</Badge>
          <CandidateStatusMark candidate={candidate} />
          {candidate.edited && <span className="text-xs text-muted-foreground">edited</span>}
          {enrichment && (
            <span className="text-xs text-muted-foreground">
              for case <span className="font-mono">{candidate.target_case_key}</span>
            </span>
          )}
        </div>
        {candidate.status === "rejected" && candidate.reject_reason && (
          <p className="flex items-start gap-1.5 text-sm text-destructive">
            <CircleXIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{rejectReasonLabel(candidate)}</span>
          </p>
        )}
        {candidate.error && <p className="text-sm text-destructive">{candidate.error}</p>}
      </div>

      <FormAlert message={error} />

      {mode === "edit" ? (
        <EditForm candidate={candidate} busy={busy} onCancel={() => onMode("view")} onSave={onSave} />
      ) : (
        <ReadView candidate={candidate} />
      )}

      {mode !== "edit" && generated && (
        <>
          <CheckChips candidate={candidate} />
          {validation?.status === "ok" && (validation.reasoning || validation.issues?.length) && (
            <Section title="Validator">
              {validation.reasoning && <p className="max-w-[65ch] text-sm text-muted-foreground">{validation.reasoning}</p>}
              {!!validation.issues?.length && (
                <ul className="flex list-disc flex-col gap-0.5 pl-5 text-sm">
                  {validation.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              )}
            </Section>
          )}
          {candidate.rationale && (
            <Section title="Why this case (generator)">
              <p className="max-w-[65ch] text-sm text-muted-foreground">{candidate.rationale}</p>
            </Section>
          )}
        </>
      )}

      {mode === "reject" ? (
        <RejectForm busy={busy} onCancel={() => onMode("view")} onReject={onReject} />
      ) : (
        mode === "view" && (
          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            {committed ? (
              <p className="text-sm text-muted-foreground">In a dataset draft. Committed candidates can&apos;t change.</p>
            ) : candidate.gen_status === "queued" ? (
              <p className="text-sm text-muted-foreground">Still generating.</p>
            ) : (
              <>
                {candidate.status !== "approved" && generated && (
                  <Button onClick={onApprove} disabled={busy}>
                    {busy && <Spinner data-icon="inline-start" />}
                    {candidate.status === "rejected" ? "Approve anyway" : "Approve"}
                    <Kbd>a</Kbd>
                  </Button>
                )}
                {generated && (
                  <Button variant="outline" onClick={() => onMode("edit")} disabled={busy}>
                    <PencilIcon data-icon="inline-start" />
                    Edit
                    <Kbd>e</Kbd>
                  </Button>
                )}
                {candidate.status !== "rejected" && (
                  <Button variant="ghost" onClick={() => onMode("reject")} disabled={busy}>
                    Reject
                    <Kbd>r</Kbd>
                  </Button>
                )}
                {candidate.status !== "pending" && generated && (
                  <Button variant="ghost" onClick={onRestore} disabled={busy}>
                    <RotateCcwIcon data-icon="inline-start" />
                    {candidate.status === "approved" ? "Undo approval" : "Back to pending"}
                  </Button>
                )}
              </>
            )}
          </div>
        )
      )}
    </div>
  );
}

function ReadView({ candidate }: { candidate: Candidate }) {
  if (candidate.gen_status === "queued") {
    return <p className="text-sm text-muted-foreground">Claude is writing this candidate. It appears here when it&apos;s checked.</p>;
  }
  const hints = candidate.seed?.hints ?? {};
  const pages = pagesText(candidate.expected_pages);
  return (
    <div className="flex flex-col gap-5">
      <Section title={candidate.target_case_key ? "Question (from the case)" : "Question"}>
        <p className="max-w-[65ch] text-lg leading-snug font-medium text-pretty">{candidate.question ?? "No question"}</p>
      </Section>
      <Section title="Reference answer">
        <p className="max-w-[65ch] text-sm leading-relaxed">
          {candidate.reference_answer || <span className="text-muted-foreground">None</span>}
        </p>
      </Section>
      {candidate.key_facts.length > 0 && (
        <Section title="Key facts">
          <ol className="flex max-w-[65ch] flex-col gap-1.5">
            {candidate.key_facts.map((fact, i) => (
              <li key={i} className="flex gap-2.5 text-sm">
                <span className="w-4 shrink-0 text-right font-mono text-xs leading-5 text-muted-foreground">{i + 1}</span>
                <span className="flex-1">{fact.fact}</span>
                <span className="shrink-0 font-mono text-xs leading-5 text-muted-foreground" title="Weight">
                  ×{fact.weight}
                </span>
              </li>
            ))}
          </ol>
        </Section>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Expected</dt>
        <dd>{humanize(candidate.expected_behavior)}</dd>
        {candidate.expected_jurisdiction && (
          <>
            <dt className="text-muted-foreground">Country</dt>
            <dd className="font-mono text-xs leading-5">{candidate.expected_jurisdiction}</dd>
          </>
        )}
        {candidate.expected_sections.length > 0 && (
          <>
            <dt className="text-muted-foreground">Sections</dt>
            <dd className="font-mono text-xs leading-5">{candidate.expected_sections.join(", ")}</dd>
          </>
        )}
        {candidate.expected_sections.length === 0 && candidate.expected_doc_codes.length > 0 && (
          <>
            <dt className="text-muted-foreground">Documents</dt>
            <dd className="font-mono text-xs leading-5">{candidate.expected_doc_codes.join(", ")}</dd>
          </>
        )}
        {pages && (
          <>
            <dt className="text-muted-foreground">Pages</dt>
            <dd className="font-mono text-xs leading-5">{pages}</dd>
          </>
        )}
        {Object.entries(hints).map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="text-muted-foreground">{humanize(key.replace(/_[ab]$/, ""))}</dt>
            <dd className="text-muted-foreground">{value.replace(/_/g, " ")}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function splitCodes(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function EditForm({
  candidate,
  busy,
  onCancel,
  onSave,
}: {
  candidate: Candidate;
  busy: boolean;
  onCancel: () => void;
  onSave: (patch: CandidatePatch) => void;
}) {
  const uid = useId();
  const enrichment = !!candidate.target_case_key;
  const [question, setQuestion] = useState(candidate.question ?? "");
  const [reference, setReference] = useState(candidate.reference_answer ?? "");
  const [facts, setFacts] = useState<KeyFact[]>(candidate.key_facts.length ? candidate.key_facts : [{ fact: "", weight: 1 }]);
  const [sections, setSections] = useState(candidate.expected_sections.join(", "));
  const [codes, setCodes] = useState(candidate.expected_doc_codes.join(", "));
  const [jurisdiction, setJurisdiction] = useState(candidate.expected_jurisdiction ?? "");
  const [behavior, setBehavior] = useState<string>(candidate.expected_behavior);
  const [problem, setProblem] = useState<string | null>(null);
  const first = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    first.current?.focus();
  }, []);

  function save() {
    const kept = facts.map((f) => ({ ...f, fact: f.fact.trim() })).filter((f) => f.fact);
    if (!enrichment && !question.trim()) {
      setProblem("The question can't be empty.");
      return;
    }
    onSave({
      ...(enrichment ? {} : { question: question.trim() }),
      reference_answer: reference.trim() || null,
      key_facts: kept,
      expected_sections: splitCodes(sections),
      expected_doc_codes: splitCodes(codes),
      expected_jurisdiction: jurisdiction.trim().toUpperCase() || null,
      expected_behavior: behavior as Candidate["expected_behavior"],
    });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      save();
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      onKeyDown={onKeyDown}
      className="flex flex-col gap-5"
      noValidate
    >
      <FormAlert message={problem} />
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor={`${uid}-q`}>Question</FieldLabel>
          <Textarea
            id={`${uid}-q`}
            ref={enrichment ? undefined : first}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={2}
            disabled={enrichment}
            className="text-base"
          />
          {enrichment && <FieldDescription>The case keeps its question; only the reference changes.</FieldDescription>}
        </Field>
        <Field>
          <FieldLabel htmlFor={`${uid}-ref`}>Reference answer</FieldLabel>
          <Textarea
            id={`${uid}-ref`}
            ref={enrichment ? first : undefined}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            rows={4}
          />
        </Field>
        <Field>
          <FieldLabel id={`${uid}-facts`}>Key facts</FieldLabel>
          <ol aria-labelledby={`${uid}-facts`} className="flex flex-col gap-2">
            {facts.map((fact, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="w-4 shrink-0 text-right font-mono text-xs text-muted-foreground">{i + 1}</span>
                <Input
                  aria-label={`Key fact ${i + 1}`}
                  value={fact.fact}
                  onChange={(e) => setFacts((all) => all.map((f, j) => (j === i ? { ...f, fact: e.target.value } : f)))}
                />
                <OptionSelect
                  aria-label={`Weight of key fact ${i + 1}`}
                  value={String(fact.weight)}
                  onValueChange={(v) => setFacts((all) => all.map((f, j) => (j === i ? { ...f, weight: Number(v) } : f)))}
                  options={[
                    { value: "3", label: "×3 essential" },
                    { value: "2", label: "×2 important" },
                    { value: "1", label: "×1 detail" },
                  ]}
                  className="w-36 shrink-0"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove key fact ${i + 1}`}
                  onClick={() => setFacts((all) => all.filter((_, j) => j !== i))}
                >
                  <TrashIcon />
                </Button>
              </li>
            ))}
          </ol>
          <div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setFacts((all) => [...all, { fact: "", weight: 1 }])}>
              <PlusIcon data-icon="inline-start" />
              Add a fact
            </Button>
          </div>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`${uid}-sections`}>Expected sections</FieldLabel>
            <Input id={`${uid}-sections`} value={sections} onChange={(e) => setSections(e.target.value)} className="font-mono text-xs" />
            <FieldDescription>Comma-separated, e.g. SIM-HR-102 §5.2</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${uid}-codes`}>Expected documents</FieldLabel>
            <Input id={`${uid}-codes`} value={codes} onChange={(e) => setCodes(e.target.value)} className="font-mono text-xs" />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${uid}-juris`}>Country</FieldLabel>
            <Input
              id={`${uid}-juris`}
              value={jurisdiction}
              onChange={(e) => setJurisdiction(e.target.value)}
              placeholder="None"
              maxLength={10}
              className="font-mono text-xs uppercase"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${uid}-behavior`}>Expected behaviour</FieldLabel>
            <OptionSelect
              id={`${uid}-behavior`}
              value={behavior}
              onValueChange={setBehavior}
              options={EXPECTED_BEHAVIORS.map((b) => ({ value: b, label: humanize(b) }))}
              className="w-full"
            />
          </Field>
        </div>
      </FieldGroup>
      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        <Button type="submit" disabled={busy}>
          {busy && <Spinner data-icon="inline-start" />}
          Save changes
          <Kbd>⌘↵</Kbd>
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
          <Kbd>esc</Kbd>
        </Button>
      </div>
    </form>
  );
}

function RejectForm({
  busy,
  onCancel,
  onReject,
}: {
  busy: boolean;
  onCancel: () => void;
  onReject: (reason: string | null) => void;
}) {
  const uid = useId();
  const [reason, setReason] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onReject(reason.trim() || null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      className="flex flex-col gap-3 border-t pt-4"
    >
      <Field>
        <FieldLabel htmlFor={`${uid}-reason`}>Why reject it? (optional)</FieldLabel>
        <Input
          id={`${uid}-reason`}
          ref={input}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          placeholder="Press Enter to reject without a reason"
        />
      </Field>
      <div className="flex flex-wrap gap-1.5">
        {QUICK_REASONS.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => onReject(r)}
            disabled={busy}
            className="h-6 rounded-full border px-2 text-xs text-muted-foreground hover:border-foreground/30 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
          >
            {r}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" variant="destructive" disabled={busy}>
          {busy && <Spinner data-icon="inline-start" />}
          Reject
          <Kbd>↵</Kbd>
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
          <Kbd>esc</Kbd>
        </Button>
      </div>
    </form>
  );
}
