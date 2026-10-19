"use client";

import { PlusIcon, Trash2Icon } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { addCase, type CaseInput, deleteCase, updateCase } from "@/app/(app)/datasets/actions";
import { OptionSelect } from "@/components/app/option-select";
import { FormAlert } from "@/components/auth/form-alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  CASE_SOURCES,
  CASE_TYPES,
  type CaseOut,
  DIFFICULTIES,
  EXPECTED_BEHAVIORS,
  type KeyFact,
} from "@/lib/api-types";
import { humanize } from "@/lib/format";

const NONE = "__none";

type Draft = {
  case_key: string;
  type: string;
  question: string;
  setup_turns: string[];
  reference_answer: string;
  key_facts: { fact: string; weight: string }[];
  expected_doc_codes: string;
  expected_sections: string;
  expected_pages: string;
  expected_departments: string;
  expected_jurisdiction: string;
  expected_behavior: string;
  scope_doc_codes: string;
  forbidden_doc_codes: string;
  injection_canary: string;
  expected_standalone_query: string;
  tags: string;
  difficulty: string;
  source: string;
  notes: string;
};

const join = (values: string[] | null | undefined) => (values ?? []).join(", ");
const split = (value: string) =>
  value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

function toDraft(c: CaseOut | null): Draft {
  return {
    case_key: c?.case_key ?? "",
    type: c?.type ?? "single_hop",
    question: c?.question ?? "",
    setup_turns: c?.setup_turns ?? [],
    reference_answer: c?.reference_answer ?? "",
    key_facts: (c?.key_facts ?? []).map((k: KeyFact) => ({ fact: k.fact, weight: String(k.weight) })),
    expected_doc_codes: join(c?.expected_doc_codes),
    expected_sections: join(c?.expected_sections),
    expected_pages: c?.expected_pages == null ? "" : JSON.stringify(c.expected_pages),
    expected_departments: join(c?.expected_departments),
    expected_jurisdiction: c?.expected_jurisdiction ?? "",
    expected_behavior: c?.expected_behavior ?? "answer",
    scope_doc_codes: join(c?.scope_doc_codes),
    forbidden_doc_codes: join(c?.forbidden_doc_codes),
    injection_canary: c?.injection_canary ?? "",
    expected_standalone_query: c?.expected_standalone_query ?? "",
    tags: join(c?.tags),
    difficulty: c?.difficulty ?? NONE,
    source: c?.source ?? "manual",
    notes: c?.notes ?? "",
  };
}

/**
 * One case's fields. Drafts are editable (each save is a PATCH, or a POST for a new case);
 * published versions are immutable, so the same form renders read-only.
 */
export function CaseForm({
  versionId,
  value,
  readOnly,
  onSaved,
  onDeleted,
}: {
  versionId: string;
  value: CaseOut | null;
  readOnly: boolean;
  onSaved: (c: CaseOut) => void;
  onDeleted: () => void;
}) {
  const uid = useId();
  const [draft, setDraft] = useState<Draft>(() => toDraft(value));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);

  function set<K extends keyof Draft>(key: K, v: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: v }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    let pages: unknown = null;
    if (draft.expected_pages.trim()) {
      try {
        pages = JSON.parse(draft.expected_pages);
      } catch {
        setError('Expected pages must be JSON, e.g. {"SIM-HR-001": [59, 60]}.');
        return;
      }
    }
    const keyFacts = draft.key_facts.filter((k) => k.fact.trim()).map((k) => ({ fact: k.fact.trim(), weight: Number(k.weight) || 1 }));
    const input: CaseInput = {
      case_key: draft.case_key.trim() || undefined,
      type: draft.type as CaseInput["type"],
      question: draft.question,
      setup_turns: draft.setup_turns.map((t) => t.trim()).filter(Boolean),
      reference_answer: draft.reference_answer,
      key_facts: keyFacts,
      expected_doc_codes: split(draft.expected_doc_codes),
      expected_sections: split(draft.expected_sections),
      expected_pages: pages,
      expected_departments: split(draft.expected_departments),
      expected_jurisdiction: draft.expected_jurisdiction,
      expected_behavior: draft.expected_behavior as CaseInput["expected_behavior"],
      scope_doc_codes: split(draft.scope_doc_codes),
      forbidden_doc_codes: split(draft.forbidden_doc_codes),
      injection_canary: draft.injection_canary,
      expected_standalone_query: draft.expected_standalone_query,
      tags: split(draft.tags),
      difficulty: draft.difficulty === NONE ? null : (draft.difficulty as CaseInput["difficulty"]),
      source: draft.source as CaseInput["source"],
      notes: draft.notes,
    };
    startTransition(async () => {
      const result = value ? await updateCase(value.id, input) : await addCase(versionId, input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved(result.data);
    });
  }

  function remove() {
    if (!value) return;
    startTransition(async () => {
      const result = await deleteCase(value.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onDeleted();
    });
  }

  const text = (key: keyof Draft, label: string, description?: string, mono = false) => (
    <Field>
      <FieldLabel htmlFor={`${uid}-${key}`}>{label}</FieldLabel>
      <Input
        id={`${uid}-${key}`}
        value={draft[key] as string}
        onChange={(e) => set(key, e.target.value as never)}
        readOnly={readOnly}
        className={mono ? "font-mono text-xs" : undefined}
      />
      {description && <FieldDescription>{description}</FieldDescription>}
    </Field>
  );

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <FormAlert message={error} />
      <FieldGroup className="gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          {text("case_key", "Case key", value ? undefined : "Leave empty to generate one.", true)}
          <Field>
            <FieldLabel htmlFor={`${uid}-type`}>Type</FieldLabel>
            <OptionSelect
              id={`${uid}-type`}
              value={draft.type}
              onValueChange={(v) => set("type", v)}
              options={CASE_TYPES.map((t) => ({ value: t, label: humanize(t) }))}
              disabled={readOnly}
              className="w-full"
            />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor={`${uid}-question`}>Question</FieldLabel>
          <Textarea
            id={`${uid}-question`}
            value={draft.question}
            onChange={(e) => set("question", e.target.value)}
            readOnly={readOnly}
            rows={3}
          />
        </Field>

        <FieldSet>
          <FieldLegend variant="label">Setup turns</FieldLegend>
          <FieldDescription>Earlier user messages, asked first in the same conversation (multi-turn cases).</FieldDescription>
          <div className="flex flex-col gap-2">
            {draft.setup_turns.map((turn, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="mt-2 w-5 font-mono text-xs text-muted-foreground">{i + 1}</span>
                <Textarea
                  aria-label={`Setup turn ${i + 1}`}
                  value={turn}
                  onChange={(e) => set("setup_turns", draft.setup_turns.map((t, j) => (j === i ? e.target.value : t)))}
                  readOnly={readOnly}
                  rows={2}
                />
                {!readOnly && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove setup turn ${i + 1}`}
                    onClick={() => set("setup_turns", draft.setup_turns.filter((_, j) => j !== i))}
                  >
                    <Trash2Icon />
                  </Button>
                )}
              </div>
            ))}
            {!readOnly && draft.setup_turns.length < 6 && (
              <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => set("setup_turns", [...draft.setup_turns, ""])}>
                <PlusIcon data-icon="inline-start" />
                Add a turn
              </Button>
            )}
            {readOnly && draft.setup_turns.length === 0 && <span className="text-sm text-muted-foreground">None</span>}
          </div>
        </FieldSet>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`${uid}-behavior`}>Expected behaviour</FieldLabel>
            <OptionSelect
              id={`${uid}-behavior`}
              value={draft.expected_behavior}
              onValueChange={(v) => set("expected_behavior", v)}
              options={EXPECTED_BEHAVIORS.map((b) => ({ value: b, label: humanize(b) }))}
              disabled={readOnly}
              className="w-full"
            />
          </Field>
          {text("expected_jurisdiction", "Expected jurisdiction", "A code like DE, or GLOBAL.", true)}
        </div>
        {text("expected_doc_codes", "Expected documents", "Comma-separated doc codes, e.g. SIM-HR-001.", true)}
        {text("expected_sections", "Expected sections", 'Comma-separated "CODE §section", e.g. SIM-HR-001 §7.4.', true)}
        <div className="grid gap-4 sm:grid-cols-2">
          {text("expected_departments", "Expected departments", "Filled from DocuMind on import.", true)}
          {text("expected_pages", "Expected pages (JSON)", undefined, true)}
        </div>

        <Field>
          <FieldLabel htmlFor={`${uid}-reference`}>Reference answer</FieldLabel>
          <Textarea
            id={`${uid}-reference`}
            value={draft.reference_answer}
            onChange={(e) => set("reference_answer", e.target.value)}
            readOnly={readOnly}
            rows={3}
          />
          <FieldDescription>Needed for correctness; without it or key facts, reference metrics are n/a.</FieldDescription>
        </Field>

        <FieldSet>
          <FieldLegend variant="label">Key facts</FieldLegend>
          <div className="flex flex-col gap-2">
            {draft.key_facts.map((k, i) => (
              <div key={i} className="flex items-start gap-2">
                <Input
                  aria-label={`Key fact ${i + 1}`}
                  value={k.fact}
                  onChange={(e) => set("key_facts", draft.key_facts.map((x, j) => (j === i ? { ...x, fact: e.target.value } : x)))}
                  readOnly={readOnly}
                />
                <Input
                  aria-label={`Weight of key fact ${i + 1}`}
                  inputMode="decimal"
                  value={k.weight}
                  onChange={(e) => set("key_facts", draft.key_facts.map((x, j) => (j === i ? { ...x, weight: e.target.value } : x)))}
                  readOnly={readOnly}
                  className="w-16 font-mono text-xs"
                />
                {!readOnly && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove key fact ${i + 1}`}
                    onClick={() => set("key_facts", draft.key_facts.filter((_, j) => j !== i))}
                  >
                    <Trash2Icon />
                  </Button>
                )}
              </div>
            ))}
            {!readOnly && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => set("key_facts", [...draft.key_facts, { fact: "", weight: "1" }])}
              >
                <PlusIcon data-icon="inline-start" />
                Add a key fact
              </Button>
            )}
            {readOnly && draft.key_facts.length === 0 && <span className="text-sm text-muted-foreground">None</span>}
          </div>
        </FieldSet>

        {text("expected_standalone_query", "Expected standalone query", "Multi-turn: the question as the router should rewrite it.")}
        <div className="grid gap-4 sm:grid-cols-2">
          {text("scope_doc_codes", "Scope to documents", "Asks with only these documents selected.", true)}
          {text("forbidden_doc_codes", "Forbidden documents", "Any of these in the sources is leakage.", true)}
        </div>
        {text("injection_canary", "Injection canary", "A phrase that must never appear in the answer.", true)}

        <div className="grid gap-4 sm:grid-cols-3">
          {text("tags", "Tags", undefined, true)}
          <Field>
            <FieldLabel htmlFor={`${uid}-difficulty`}>Difficulty</FieldLabel>
            <OptionSelect
              id={`${uid}-difficulty`}
              value={draft.difficulty}
              onValueChange={(v) => set("difficulty", v)}
              options={[{ value: NONE, label: "Not set" }, ...DIFFICULTIES.map((d) => ({ value: d, label: humanize(d) }))]}
              disabled={readOnly}
              className="w-full"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${uid}-source`}>Source</FieldLabel>
            <OptionSelect
              id={`${uid}-source`}
              value={draft.source}
              onValueChange={(v) => set("source", v)}
              options={CASE_SOURCES.map((s) => ({ value: s, label: humanize(s) }))}
              disabled={readOnly}
              className="w-full"
            />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor={`${uid}-notes`}>Notes</FieldLabel>
          <Textarea id={`${uid}-notes`} value={draft.notes} onChange={(e) => set("notes", e.target.value)} readOnly={readOnly} rows={2} />
        </Field>
      </FieldGroup>

      {!readOnly && (
        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t bg-popover py-4">
          {value ? (
            confirmDelete ? (
              <span className="flex items-center gap-2 text-sm">
                Delete this case?
                <Button type="button" variant="destructive" size="sm" onClick={remove} disabled={pending}>
                  Delete
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                  Keep
                </Button>
              </span>
            ) : (
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                <Trash2Icon data-icon="inline-start" />
                Delete case
              </Button>
            )
          ) : (
            <span />
          )}
          <Button type="submit" disabled={pending}>
            {pending && <Spinner data-icon="inline-start" />}
            {value ? "Save case" : "Add case"}
          </Button>
        </div>
      )}
    </form>
  );
}
