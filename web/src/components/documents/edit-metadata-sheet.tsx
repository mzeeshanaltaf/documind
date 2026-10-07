"use client";

import { RefreshCwIcon, XIcon } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { reindexDocument, updateDocument } from "@/app/(app)/app/[orgSlug]/documents/actions";
import { type Option, OptionSelect } from "@/components/app/option-select";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { DEPARTMENTS, DOC_TYPES, type DocumentRow } from "@/lib/api-types";
import { DOC_CODE_PATTERN, type MetadataField, type MetadataInput, metadataSchema } from "@/lib/document-metadata";
import { COMMON_JURISDICTIONS, DOC_TYPE_LABELS, jurisdictionName } from "@/lib/format";

const NONE = "__none__";

type Draft = Omit<MetadataInput, "department" | "jurisdiction" | "doc_type" | "related_doc_codes"> & {
  department: string;
  jurisdiction: string;
  doc_type: string;
  related_doc_codes: string[];
};

function draftFrom(doc: DocumentRow): Draft {
  return {
    title: doc.title,
    doc_code: doc.doc_code ?? "",
    legal_entity: doc.legal_entity ?? "",
    department: doc.department ?? NONE,
    jurisdiction: doc.jurisdiction ?? NONE,
    doc_type: doc.doc_type ?? NONE,
    version: doc.version ?? "",
    effective_date: doc.effective_date ?? "",
    owner: doc.owner ?? "",
    approved_by: doc.approved_by ?? "",
    review_cycle: doc.review_cycle ?? "",
    applies_to: doc.applies_to ?? "",
    related_doc_codes: doc.related_doc_codes,
  };
}

const unset = (value: string) => (value === NONE ? null : value);

const departmentOptions: Option[] = [{ value: NONE, label: "Not set" }, ...DEPARTMENTS.map((d) => ({ value: d, label: d }))];
const docTypeOptions: Option[] = [
  { value: NONE, label: "Not set" },
  ...DOC_TYPES.map((t) => ({ value: t, label: DOC_TYPE_LABELS[t] ?? t })),
];

function jurisdictionOptions(current: string | null): Option[] {
  const codes = new Set<string>(COMMON_JURISDICTIONS);
  if (current) codes.add(current);
  return [
    { value: NONE, label: "Not set" },
    ...[...codes].map((code) => ({ value: code, label: code === "GLOBAL" ? "Global" : `${jurisdictionName(code)} (${code})` })),
  ];
}

type Props = {
  orgSlug: string;
  doc: DocumentRow | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (doc: DocumentRow) => void;
  onReindexed: () => void;
};

export function EditMetadataSheet({ orgSlug, doc, onOpenChange, onSaved, onReindexed }: Props) {
  return (
    <Sheet open={!!doc} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 data-[side=right]:sm:max-w-lg">
        {doc && (
          <MetadataForm
            key={doc.id}
            orgSlug={orgSlug}
            doc={doc}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
            onReindexed={onReindexed}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function MetadataForm({
  orgSlug,
  doc,
  onClose,
  onSaved,
  onReindexed,
}: {
  orgSlug: string;
  doc: DocumentRow;
  onClose: () => void;
  onSaved: (doc: DocumentRow) => void;
  onReindexed: () => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(doc));
  const [errors, setErrors] = useState<Partial<Record<MetadataField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [needsReindex, setNeedsReindex] = useState(false);
  const [saving, startSaving] = useTransition();
  const [reindexing, startReindex] = useTransition();

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const input: MetadataInput = {
      ...draft,
      department: unset(draft.department) as MetadataInput["department"],
      jurisdiction: unset(draft.jurisdiction),
      doc_type: unset(draft.doc_type) as MetadataInput["doc_type"],
    };
    const parsed = metadataSchema.safeParse(input);
    if (!parsed.success) {
      const next: Partial<Record<MetadataField, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as MetadataField;
        next[key] ??= issue.message;
      }
      setErrors(next);
      setFormError("Fix the highlighted fields and save again.");
      return;
    }
    setFormError(null);
    startSaving(async () => {
      const result = await updateDocument(orgSlug, doc.id, input);
      if (!result.ok) {
        setFormError(result.error);
        return;
      }
      onSaved(result.data);
      if (result.data.needs_reindex) {
        setNeedsReindex(true);
      } else {
        toast.success("Metadata saved.");
        onClose();
      }
    });
  }

  function reindex() {
    startReindex(async () => {
      const result = await reindexDocument(orgSlug, doc.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Reindex started. The new metadata applies when it finishes.");
      onReindexed();
      onClose();
    });
  }

  const field = (key: MetadataField) => ({
    id: `${id}-${key}`,
    "aria-invalid": errors[key] ? true : undefined,
  });

  const text = (key: Exclude<keyof Draft, "department" | "jurisdiction" | "doc_type" | "related_doc_codes">, label: string, hint?: string, mono?: boolean) => (
    <Field data-invalid={errors[key] ? true : undefined}>
      <FieldLabel htmlFor={`${id}-${key}`}>{label}</FieldLabel>
      <Input
        {...field(key)}
        value={(draft[key] as string | null) ?? ""}
        className={mono ? "font-mono" : undefined}
        onChange={(e) => set(key, e.target.value)}
      />
      {hint && !errors[key] && <FieldDescription>{hint}</FieldDescription>}
      {errors[key] && <FieldError>{errors[key]}</FieldError>}
    </Field>
  );

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <SheetHeader className="border-b px-5 pt-5 pr-12 pb-4">
        <SheetTitle className="text-lg font-semibold">Edit metadata</SheetTitle>
        <SheetDescription className="truncate">{doc.title}</SheetDescription>
      </SheetHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {needsReindex && (
          <Alert className="mb-5">
            <RefreshCwIcon />
            <AlertTitle>Saved. Reindex to update answers</AlertTitle>
            <AlertDescription>
              The title, code or entity are part of every passage&apos;s context. Filters changed right away.
            </AlertDescription>
            <AlertAction>
              <Button type="button" size="sm" onClick={reindex} disabled={reindexing}>
                {reindexing && <Spinner data-icon="inline-start" />}
                Reindex now
              </Button>
            </AlertAction>
          </Alert>
        )}
        {formError && (
          <Alert variant="destructive" className="mb-5">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}

        <FieldGroup>
          {text("title", "Title")}
          <div className="grid gap-5 sm:grid-cols-2">
            {text("doc_code", "Document code", "e.g. SIM-HR-102", true)}
            {text("version", "Version")}
          </div>
          {text("legal_entity", "Legal entity")}
          <div className="grid gap-5 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={`${id}-department`}>Department</FieldLabel>
              <OptionSelect
                id={`${id}-department`}
                value={draft.department}
                onValueChange={(v) => set("department", v)}
                options={departmentOptions}
                className="w-full"
              />
            </Field>
            <Field data-invalid={errors.jurisdiction ? true : undefined}>
              <FieldLabel htmlFor={`${id}-jurisdiction`}>Jurisdiction</FieldLabel>
              <OptionSelect
                id={`${id}-jurisdiction`}
                value={draft.jurisdiction}
                onValueChange={(v) => set("jurisdiction", v)}
                options={jurisdictionOptions(doc.jurisdiction)}
                className="w-full"
                invalid={!!errors.jurisdiction}
              />
              {errors.jurisdiction && <FieldError>{errors.jurisdiction}</FieldError>}
            </Field>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={`${id}-doc_type`}>Document type</FieldLabel>
              <OptionSelect
                id={`${id}-doc_type`}
                value={draft.doc_type}
                onValueChange={(v) => set("doc_type", v)}
                options={docTypeOptions}
                className="w-full"
              />
            </Field>
            <Field data-invalid={errors.effective_date ? true : undefined}>
              <FieldLabel htmlFor={`${id}-effective_date`}>Effective date</FieldLabel>
              <Input
                {...field("effective_date")}
                type="date"
                value={draft.effective_date ?? ""}
                onChange={(e) => set("effective_date", e.target.value)}
              />
              {errors.effective_date && <FieldError>{errors.effective_date}</FieldError>}
            </Field>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            {text("owner", "Owner")}
            {text("approved_by", "Approved by")}
          </div>
          {text("review_cycle", "Review cycle")}
          <Field data-invalid={errors.applies_to ? true : undefined}>
            <FieldLabel htmlFor={`${id}-applies_to`}>Applies to</FieldLabel>
            <Textarea
              {...field("applies_to")}
              value={draft.applies_to ?? ""}
              onChange={(e) => set("applies_to", e.target.value)}
            />
            {errors.applies_to && <FieldError>{errors.applies_to}</FieldError>}
          </Field>
          <Field data-invalid={errors.related_doc_codes ? true : undefined}>
            <FieldLabel htmlFor={`${id}-related`}>Related documents</FieldLabel>
            <CodeTagInput
              id={`${id}-related`}
              value={draft.related_doc_codes}
              onChange={(codes) => set("related_doc_codes", codes)}
              invalid={!!errors.related_doc_codes}
            />
            {errors.related_doc_codes ? (
              <FieldError>{errors.related_doc_codes}</FieldError>
            ) : (
              <FieldDescription>Type a code and press Enter or comma.</FieldDescription>
            )}
          </Field>
        </FieldGroup>
      </div>

      <SheetFooter className="flex-row justify-end border-t px-5 py-3">
        <Button type="button" variant="ghost" onClick={onClose}>
          {needsReindex ? "Close" : "Cancel"}
        </Button>
        <Button type="submit" disabled={saving}>
          {saving && <Spinner data-icon="inline-start" />}
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </SheetFooter>
    </form>
  );
}

/** Document codes as removable chips; Enter or comma adds, Backspace on empty removes the last. */
function CodeTagInput({
  id,
  value,
  onChange,
  invalid,
}: {
  id: string;
  value: string[];
  onChange: (codes: string[]) => void;
  invalid?: boolean;
}) {
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  function commit(raw: string) {
    const codes = raw
      .split(/[\s,]+/)
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);
    if (!codes.length) return;
    const bad = codes.filter((c) => !DOC_CODE_PATTERN.test(c));
    if (bad.length) {
      setProblem(`${bad.join(", ")} doesn't look like a document code.`);
      return;
    }
    onChange([...new Set([...value, ...codes])]);
    setText("");
    setProblem(null);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="flex min-h-8 flex-wrap items-center gap-1.5 rounded-lg border border-input px-1.5 py-1 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 aria-invalid:border-destructive"
        aria-invalid={invalid || !!problem || undefined}
      >
        {value.map((code) => (
          <Badge key={code} variant="secondary" className="gap-1 pr-0.5 font-mono text-[0.7rem]">
            {code}
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="size-4 rounded-sm"
              aria-label={`Remove ${code}`}
              onClick={() => onChange(value.filter((c) => c !== code))}
            >
              <XIcon />
            </Button>
          </Badge>
        ))}
        <input
          id={id}
          value={text}
          placeholder={value.length ? "" : "SIM-HR-001"}
          className="h-6 min-w-24 flex-1 bg-transparent px-1 font-mono text-sm uppercase outline-none placeholder:text-muted-foreground"
          onChange={(e) => {
            setText(e.target.value);
            setProblem(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit(text);
            } else if (e.key === "Backspace" && !text && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => commit(text)}
        />
      </div>
      {problem && <p className="text-xs text-destructive">{problem}</p>}
    </div>
  );
}
