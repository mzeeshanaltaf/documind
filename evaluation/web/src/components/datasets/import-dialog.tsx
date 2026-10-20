"use client";

import { FileUpIcon, UploadIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";
import { OptionSelect } from "@/components/app/option-select";
import { FormAlert } from "@/components/auth/form-alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DATASET_KINDS, type DatasetKind, type ImportResult } from "@/lib/api-types";
import { humanize, plural } from "@/lib/format";

/** CaseFields (app/schemas/datasets.py): what a source key can map to. */
const CASE_FIELDS = [
  "case_key",
  "type",
  "question",
  "setup_turns",
  "reference_answer",
  "key_facts",
  "expected_doc_codes",
  "expected_sections",
  "expected_pages",
  "expected_departments",
  "expected_jurisdiction",
  "expected_behavior",
  "scope_doc_codes",
  "forbidden_doc_codes",
  "injection_canary",
  "expected_standalone_query",
  "probes",
  "tags",
  "difficulty",
  "source",
  "notes",
];
const IGNORE = "__ignore";
const SAMPLE_LINES = 200;

/** Keys of the first JSON lines, so unknown ones can be mapped before the server sees the file. */
async function sourceKeys(file: File): Promise<string[]> {
  const head = await file.slice(0, 512 * 1024).text();
  const keys = new Set<string>();
  for (const line of head.split(/\r?\n/).slice(0, SAMPLE_LINES)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row && typeof row === "object" && !Array.isArray(row)) for (const key of Object.keys(row)) keys.add(key);
    } catch {
      // A bad line is reported by the server's preview, with its line number.
    }
  }
  return [...keys];
}

export function ImportDialog({
  dataset,
  trigger = "Import JSONL",
}: {
  /** Importing into an existing dataset fixes its slug; otherwise a new dataset is created. */
  dataset?: { slug: string; name: string; kind: DatasetKind; default_org_slug: string | null };
  trigger?: string;
}) {
  const uid = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [keys, setKeys] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [slug, setSlug] = useState(dataset?.slug ?? "");
  const [name, setName] = useState(dataset?.name ?? "");
  const [kind, setKind] = useState<DatasetKind>(dataset?.kind ?? "mixed");
  const [org, setOrg] = useState(dataset?.default_org_slug ?? "");
  const [prefix, setPrefix] = useState("");
  const [fillDepartments, setFillDepartments] = useState(true);
  const [publish, setPublish] = useState(false);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);

  const unknown = keys.filter((k) => !CASE_FIELDS.includes(k));

  function reset() {
    setFile(null);
    setKeys([]);
    setMapping({});
    setPreview(null);
    setError(null);
  }

  async function chooseFile(next: File | null) {
    reset();
    setFile(next);
    if (next) setKeys(await sourceKeys(next));
  }

  function form(): FormData {
    const data = new FormData();
    data.set("file", file!);
    data.set("dataset_slug", slug.trim());
    if (name.trim()) data.set("dataset_name", name.trim());
    if (org.trim()) data.set("default_org_slug", org.trim());
    data.set("kind", kind);
    if (prefix.trim()) data.set("key_prefix", prefix.trim());
    data.set("fill_departments", String(fillDepartments));
    data.set("publish", String(publish));
    // {target_field: source_key}
    const map = Object.fromEntries(
      Object.entries(mapping)
        .filter(([, target]) => target !== IGNORE)
        .map(([source, target]) => [target, source]),
    );
    if (Object.keys(map).length) data.set("mapping", JSON.stringify(map));
    return data;
  }

  async function send(isPreview: boolean) {
    setError(null);
    if (!file) return setError("Choose a JSONL file first.");
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug.trim())) {
      return setError("The dataset slug takes lowercase letters, digits and hyphens.");
    }
    setBusy(isPreview ? "preview" : "import");
    try {
      const response = await fetch(`/api/backend/datasets/import${isPreview ? "?preview=true" : ""}`, {
        method: "POST",
        body: form(),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.error?.message ?? `The import failed (${response.status}).`);
        return;
      }
      const result = body as ImportResult;
      if (isPreview) {
        setPreview(result);
        return;
      }
      if (result.unchanged) {
        toast.info("The file matches the latest published version, so nothing was imported.");
      } else if (result.version && result.dataset) {
        toast.success(`Imported ${plural(result.cases.length, "case")} as v${result.version.version}.`);
        setOpen(false);
        router.push(`/datasets/${result.dataset.id}/v/${result.version.version}`);
        router.refresh();
      }
    } catch {
      setError("The eval API couldn't be reached. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger render={<Button variant="outline" />}>
        <UploadIcon data-icon="inline-start" />
        {trigger}
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import cases from JSONL</DialogTitle>
          <DialogDescription>
            One case per line. The file becomes a new version holding exactly these cases; missing keys are generated and
            missing types inferred.
          </DialogDescription>
        </DialogHeader>
        <FormAlert message={error} />
        <FieldGroup className="gap-5">
          <Field>
            <FieldLabel htmlFor={`${uid}-file`}>File</FieldLabel>
            <Input
              id={`${uid}-file`}
              type="file"
              accept=".jsonl,.ndjson,.json,application/x-ndjson,application/json"
              onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
            />
            <FieldDescription>UTF-8, up to 5 MB.</FieldDescription>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={`${uid}-slug`}>Dataset slug</FieldLabel>
              <Input
                id={`${uid}-slug`}
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                readOnly={!!dataset}
                className="font-mono"
                placeholder="golden"
              />
              <FieldDescription>{dataset ? "Imports as a new version of this dataset." : "A new slug creates the dataset."}</FieldDescription>
            </Field>
            {!dataset && (
              <Field>
                <FieldLabel htmlFor={`${uid}-name`}>Dataset name</FieldLabel>
                <Input id={`${uid}-name`} value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
            )}
            {!dataset && (
              <Field>
                <FieldLabel htmlFor={`${uid}-kind`}>Kind</FieldLabel>
                <OptionSelect
                  id={`${uid}-kind`}
                  value={kind}
                  onValueChange={(v) => setKind(v as DatasetKind)}
                  options={DATASET_KINDS.map((k) => ({ value: k, label: humanize(k) }))}
                  className="w-full"
                />
              </Field>
            )}
            {!dataset && (
              <Field>
                <FieldLabel htmlFor={`${uid}-org`}>Default org</FieldLabel>
                <Input id={`${uid}-org`} value={org} onChange={(e) => setOrg(e.target.value)} className="font-mono" placeholder="simtora" />
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor={`${uid}-prefix`}>Key prefix</FieldLabel>
              <Input id={`${uid}-prefix`} value={prefix} onChange={(e) => setPrefix(e.target.value)} className="font-mono" placeholder={slug || "case"} />
              <FieldDescription>Rows without a case_key get prefix-001, prefix-002, …</FieldDescription>
            </Field>
          </div>

          {unknown.length > 0 && (
            <FieldSet>
              <FieldLegend variant="label">Map the file&apos;s other keys</FieldLegend>
              <FieldDescription>
                These keys aren&apos;t case fields. Map each to a field, or leave it ignored.
              </FieldDescription>
              <div className="flex flex-col gap-2">
                {unknown.map((key) => (
                  <div key={key} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                    <span className="truncate font-mono text-xs">{key}</span>
                    <span className="text-muted-foreground" aria-hidden>
                      →
                    </span>
                    <OptionSelect
                      size="sm"
                      aria-label={`Map ${key} to`}
                      value={mapping[key] ?? IGNORE}
                      onValueChange={(v) => {
                        setMapping((m) => ({ ...m, [key]: v }));
                        setPreview(null); // the preview no longer matches
                      }}
                      options={[{ value: IGNORE, label: "Ignore" }, ...CASE_FIELDS.map((f) => ({ value: f, label: f }))]}
                      className="w-full font-mono"
                    />
                  </div>
                ))}
              </div>
            </FieldSet>
          )}
          {keys.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Case fields found: <span className="font-mono">{keys.filter((k) => CASE_FIELDS.includes(k)).join(", ") || "none"}</span>
            </p>
          )}

          <Field orientation="horizontal">
            <Switch id={`${uid}-fill`} checked={fillDepartments} onCheckedChange={setFillDepartments} />
            <FieldContent>
              <FieldLabel htmlFor={`${uid}-fill`}>Fill expected departments from DocuMind</FieldLabel>
              <FieldDescription>Looks up each expected document&apos;s department in the default org.</FieldDescription>
            </FieldContent>
          </Field>
          <Field orientation="horizontal">
            <Switch id={`${uid}-publish`} checked={publish} onCheckedChange={setPublish} />
            <FieldContent>
              <FieldLabel htmlFor={`${uid}-publish`}>Publish right away</FieldLabel>
              <FieldDescription>Otherwise it stays a draft you can edit before publishing.</FieldDescription>
            </FieldContent>
          </Field>
        </FieldGroup>

        {preview && <ImportPreview result={preview} />}

        <DialogFooter>
          <Button variant="outline" onClick={() => send(true)} disabled={!file || busy !== null}>
            {busy === "preview" ? <Spinner data-icon="inline-start" /> : <FileUpIcon data-icon="inline-start" />}
            Preview
          </Button>
          <Button onClick={() => send(false)} disabled={!preview || preview.errors.length > 0 || busy !== null}>
            {busy === "import" && <Spinner data-icon="inline-start" />}
            Import {preview ? plural(preview.cases.length, "case") : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportPreview({ result }: { result: ImportResult }) {
  return (
    <section aria-label="Import preview" className="flex flex-col gap-3">
      <p className="text-sm">
        {plural(result.cases.length, "case")} parsed
        {result.errors.length > 0 && <span className="text-destructive">, {plural(result.errors.length, "error")}</span>}
        {result.warnings.length > 0 && <span className="text-warning">, {plural(result.warnings.length, "warning")}</span>}.
      </p>
      {result.errors.length > 0 && (
        <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md bg-destructive/10 p-3 text-xs text-destructive">
          {result.errors.map((e, i) => (
            <li key={i}>
              <span className="font-mono">line {e.line}</span>: {e.message}
            </li>
          ))}
        </ul>
      )}
      {result.warnings.length > 0 && (
        <ul className="flex max-h-32 flex-col gap-1 overflow-y-auto rounded-md bg-muted p-3 text-xs text-muted-foreground">
          {result.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      {result.cases.length > 0 && (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Question</TableHead>
                <TableHead className="hidden sm:table-cell">Expected</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.cases.slice(0, 8).map((c) => (
                <TableRow key={c.case_key}>
                  <TableCell className="font-mono text-xs">{c.case_key}</TableCell>
                  <TableCell className="text-xs">{humanize(c.type)}</TableCell>
                  <TableCell className="max-w-56 truncate text-xs">{c.question}</TableCell>
                  <TableCell className="hidden max-w-40 truncate font-mono text-[0.7rem] sm:table-cell">
                    {(c.expected_sections.length ? c.expected_sections : c.expected_doc_codes).join(", ") || "none"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {result.cases.length > 8 && (
            <p className="border-t px-3 py-2 text-xs text-muted-foreground">and {result.cases.length - 8} more</p>
          )}
        </div>
      )}
    </section>
  );
}
