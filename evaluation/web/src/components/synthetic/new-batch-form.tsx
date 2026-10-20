"use client";

import { ShuffleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { createBatch } from "@/app/(app)/synthetic/actions";
import { OptionSelect } from "@/components/app/option-select";
import { FormAlert } from "@/components/auth/form-alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  type BatchKind,
  type DatasetOut,
  type DocumindDocument,
  GENERATOR_MODELS,
  type OrgAccess,
  SYNTHETIC_TYPES,
  type SyntheticType,
} from "@/lib/api-types";
import { formatCost } from "@/lib/format";
import { TYPE_HINTS, TYPE_LABELS } from "./labels";

export type VersionOption = { id: string; label: string; cases: number };

/** README › Cost guide: ≈ $0.07 per generated candidate; references are cheaper (no sampling). */
const COST_PER = { synthetic: 0.07, enrichment: 0.05 } as const;
const NONE = "__none";
const DEFAULT_COUNTS: Record<SyntheticType, number> = {
  single_hop: 12,
  multi_hop: 8,
  jurisdiction: 8,
  comparative: 4,
  unanswerable: 4,
  out_of_scope: 4,
};

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return (await response.json()) as T;
}

export function NewBatchForm({
  orgs,
  datasets,
  versions,
  initialKind,
  initialVersionId,
}: {
  orgs: OrgAccess[];
  datasets: DatasetOut[];
  versions: VersionOption[];
  initialKind: BatchKind;
  initialVersionId?: string;
}) {
  const uid = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<BatchKind>(initialKind);
  const [name, setName] = useState("");
  const [orgSlug, setOrgSlug] = useState(orgs[0]?.slug ?? "");
  const org = orgs.find((o) => o.slug === orgSlug);
  const [target, setTarget] = useState(NONE);
  const [counts, setCounts] = useState<Record<SyntheticType, string>>(
    () => Object.fromEntries(SYNTHETIC_TYPES.map((t) => [t, String(DEFAULT_COUNTS[t])])) as Record<SyntheticType, string>,
  );
  const [model, setModel] = useState<string>(GENERATOR_MODELS[0]);
  const [seed, setSeed] = useState("");
  const [cap, setCap] = useState("");
  const [versionId, setVersionId] = useState(
    versions.some((v) => v.id === initialVersionId) ? initialVersionId! : (versions[0]?.id ?? ""),
  );
  const [onlyMissing, setOnlyMissing] = useState(true);

  const { data: documents, error: docsError } = useSWR(
    kind === "synthetic" && org ? `/api/backend/documind/orgs/${org.id}/documents` : null,
    getJson<DocumindDocument[]>,
  );
  const ready = useMemo(
    () =>
      (documents ?? [])
        .filter((d) => (d.status ?? "ready") === "ready")
        .sort((a, b) => (a.doc_code ?? a.title).localeCompare(b.doc_code ?? b.title)),
    [documents],
  );
  // Unchecked ids, so a newly loaded org starts with everything selected.
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const selected = ready.filter((d) => !excluded.has(d.id));
  const supplements = selected.filter((d) => d.doc_type === "country_supplement").length;

  const total = SYNTHETIC_TYPES.reduce((sum, t) => sum + (Number(counts[t]) || 0), 0);
  const version = versions.find((v) => v.id === versionId);
  const n = kind === "synthetic" ? total : (version?.cases ?? 0);
  const estimate = n * COST_PER[kind];

  function chooseOrg(slug: string) {
    setOrgSlug(slug);
    setExcluded(new Set());
  }

  function chooseTarget(value: string) {
    setTarget(value);
    const dataset = datasets.find((d) => d.id === value);
    if (dataset?.default_org_slug && orgs.some((o) => o.slug === dataset.default_org_slug))
      chooseOrg(dataset.default_org_slug);
  }

  function toggleDoc(docId: string, on: boolean) {
    setExcluded((current) => {
      const next = new Set(current);
      if (on) next.delete(docId);
      else next.add(docId);
      return next;
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const capValue = cap.trim() ? Number(cap) : null;
    if (capValue !== null && (!Number.isFinite(capValue) || capValue <= 0 || capValue > 100)) {
      setError("The cost cap must be between $0.01 and $100.");
      return;
    }
    let input: Parameters<typeof createBatch>[0];
    if (kind === "synthetic") {
      const typeCounts: Partial<Record<SyntheticType, number>> = {};
      for (const t of SYNTHETIC_TYPES) {
        const value = Number(counts[t] || 0);
        if (!Number.isInteger(value) || value < 0 || value > 100) {
          setError(`${TYPE_LABELS[t]}: enter a whole number from 0 to 100.`);
          return;
        }
        if (value) typeCounts[t] = value;
      }
      if (total < 1 || total > 200) {
        setError("Ask for 1 to 200 candidates in total.");
        return;
      }
      if (!orgSlug) {
        setError("Pick an organization.");
        return;
      }
      if (ready.length && selected.length === 0) {
        setError("Select at least one document.");
        return;
      }
      const seedValue = seed.trim() ? Number(seed) : null;
      if (seedValue !== null && (!Number.isInteger(seedValue) || seedValue < 0)) {
        setError("The seed must be a whole number.");
        return;
      }
      input = {
        kind,
        name: name.trim() || null,
        org_slug: orgSlug,
        target_dataset_id: target === NONE ? null : target,
        // Everything selected = all ready documents (the API's default), robust to uploads.
        document_ids: selected.length === ready.length ? [] : selected.map((d) => d.id),
        type_counts: typeCounts,
        generator_model: model as (typeof GENERATOR_MODELS)[number],
        seed: seedValue,
        max_cost_usd: capValue,
      };
    } else {
      if (!versionId) {
        setError("Pick the dataset version to enrich.");
        return;
      }
      input = {
        kind,
        name: name.trim() || null,
        dataset_version_id: versionId,
        generator_model: model as (typeof GENERATOR_MODELS)[number],
        only_missing: onlyMissing,
        max_cost_usd: capValue,
      };
    }
    startTransition(async () => {
      const result = await createBatch(input);
      if (!result.ok) {
        setError(result.error);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      toast.success(`Generating ${result.data.candidate_count} candidates.`);
      router.push(`/synthetic/${result.data.id}`);
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-10" noValidate>
      <FormAlert message={error} />

      <FieldSet>
        <FieldLegend>What to generate</FieldLegend>
        <FieldGroup>
          <Field>
            <FieldLabel id={`${uid}-kind`}>Kind</FieldLabel>
            <ToggleGroup
              aria-labelledby={`${uid}-kind`}
              variant="outline"
              size="sm"
              spacing={0}
              value={[kind]}
              onValueChange={(v: string[]) => v[0] && setKind(v[0] as BatchKind)}
            >
              <ToggleGroupItem value="synthetic">New test cases</ToggleGroupItem>
              <ToggleGroupItem value="enrichment">Reference answers</ToggleGroupItem>
            </ToggleGroup>
            <FieldDescription>
              {kind === "synthetic"
                ? "Writes new questions from sampled passages, with reference answers and key facts."
                : "Writes a reference answer and key facts for each case of a dataset version, from its expected sections. Approved ones go into a new draft version."}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${uid}-name`}>Name</FieldLabel>
            <Input
              id={`${uid}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={kind === "synthetic" ? "e.g. Synthetic v1, all types" : "e.g. Golden references"}
              maxLength={200}
            />
          </Field>
        </FieldGroup>
      </FieldSet>

      {kind === "synthetic" ? (
        <>
          <FieldSet>
            <FieldLegend>Source</FieldLegend>
            <FieldGroup>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor={`${uid}-org`}>Organization</FieldLabel>
                  <OptionSelect
                    id={`${uid}-org`}
                    value={orgSlug}
                    onValueChange={chooseOrg}
                    options={orgs.map((o) => ({ value: o.slug, label: `${o.name} (${o.slug})` }))}
                    placeholder="No orgs visible"
                    disabled={!orgs.length}
                    className="w-full"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${uid}-target`}>Target dataset</FieldLabel>
                  <OptionSelect
                    id={`${uid}-target`}
                    value={target}
                    onValueChange={chooseTarget}
                    options={[
                      { value: NONE, label: "None (pick when committing)" },
                      ...datasets.map((d) => ({ value: d.id, label: d.name })),
                    ]}
                    className="w-full"
                  />
                  <FieldDescription>Questions too close to its cases are flagged as duplicates.</FieldDescription>
                </Field>
              </div>
              <DocumentPicker
                documents={ready}
                loading={!documents && !docsError}
                failed={!!docsError}
                excluded={excluded}
                onToggle={toggleDoc}
                onAll={(on) => setExcluded(on ? new Set() : new Set(ready.map((d) => d.id)))}
              />
            </FieldGroup>
          </FieldSet>

          <FieldSet>
            <FieldLegend>Case types</FieldLegend>
            <FieldDescription>
              Types are interleaved, so a batch stopped early still covers each one.
              {supplements === 0 && ready.length > 0 && (
                <> Jurisdiction and comparative cases need country supplements among the selected documents.</>
              )}
            </FieldDescription>
            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              {SYNTHETIC_TYPES.map((t) => (
                <Field key={t} orientation="horizontal" className="items-start">
                  <Input
                    id={`${uid}-count-${t}`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={100}
                    value={counts[t]}
                    onChange={(e) => setCounts((c) => ({ ...c, [t]: e.target.value }))}
                    className="w-20 font-mono tabular-nums"
                  />
                  <FieldContent>
                    <FieldLabel htmlFor={`${uid}-count-${t}`}>{TYPE_LABELS[t]}</FieldLabel>
                    <FieldDescription>{TYPE_HINTS[t]}</FieldDescription>
                  </FieldContent>
                </Field>
              ))}
            </div>
          </FieldSet>
        </>
      ) : (
        <FieldSet>
          <FieldLegend>Cases</FieldLegend>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${uid}-version`}>Dataset version</FieldLabel>
              <OptionSelect
                id={`${uid}-version`}
                value={versionId}
                onValueChange={setVersionId}
                options={versions.map((v) => ({ value: v.id, label: `${v.label} (${v.cases} cases)` }))}
                placeholder="No versions with cases"
                disabled={!versions.length}
                className="w-full"
              />
              <FieldDescription>
                The version isn&apos;t changed: approved references go into the dataset&apos;s draft.
              </FieldDescription>
            </Field>
            <Field orientation="horizontal">
              <Switch id={`${uid}-missing`} checked={onlyMissing} onCheckedChange={setOnlyMissing} />
              <FieldContent>
                <FieldLabel htmlFor={`${uid}-missing`}>Only cases without a reference</FieldLabel>
                <FieldDescription>Skip cases that already have a reference answer and key facts.</FieldDescription>
              </FieldContent>
            </Field>
          </FieldGroup>
        </FieldSet>
      )}

      <FieldSet>
        <FieldLegend>Generation</FieldLegend>
        <FieldGroup>
          <div className="grid gap-5 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor={`${uid}-model`}>Generator model</FieldLabel>
              <OptionSelect
                id={`${uid}-model`}
                value={model}
                onValueChange={setModel}
                options={GENERATOR_MODELS.map((m) => ({ value: m, label: m }))}
                className="w-full font-mono"
              />
            </Field>
            {kind === "synthetic" && (
              <Field>
                <FieldLabel htmlFor={`${uid}-seed`}>Seed</FieldLabel>
                <div className="flex gap-2">
                  <Input
                    id={`${uid}-seed`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={seed}
                    placeholder="Random"
                    onChange={(e) => setSeed(e.target.value)}
                    className="font-mono tabular-nums"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="New random seed"
                    onClick={() => setSeed(String(Math.floor(Math.random() * 1_000_000)))}
                  >
                    <ShuffleIcon />
                  </Button>
                </div>
                <FieldDescription>Blank draws one; it&apos;s shown on the batch.</FieldDescription>
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor={`${uid}-cap`}>Cost cap (USD)</FieldLabel>
              <Input
                id={`${uid}-cap`}
                type="number"
                min={0}
                step="0.5"
                inputMode="decimal"
                placeholder={(estimate * 2).toFixed(2)}
                value={cap}
                onChange={(e) => setCap(e.target.value)}
                className="font-mono"
              />
              <FieldDescription>The batch pauses when its spend reaches this. Default: 2× the estimate.</FieldDescription>
            </Field>
          </div>
        </FieldGroup>
      </FieldSet>

      <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-6">
        <p className="text-sm text-muted-foreground tabular-nums">
          {n} candidate{n === 1 ? "" : "s"} · estimated <span className="font-medium text-foreground">{formatCost(estimate)}</span>
          {kind === "synthetic" && <> (≈ ${COST_PER.synthetic.toFixed(2)} each: Opus writes, Sonnet checks)</>}
        </p>
        <Button type="submit" disabled={pending || n === 0}>
          {pending && <Spinner data-icon="inline-start" />}
          {pending ? "Sampling passages…" : "Generate batch"}
        </Button>
      </div>
    </form>
  );
}

function DocumentPicker({
  documents,
  loading,
  failed,
  excluded,
  onToggle,
  onAll,
}: {
  documents: DocumindDocument[];
  loading: boolean;
  failed: boolean;
  excluded: Set<string>;
  onToggle: (id: string, on: boolean) => void;
  onAll: (on: boolean) => void;
}) {
  const uid = useId();
  const chosen = documents.filter((d) => !excluded.has(d.id)).length;
  return (
    <Field>
      <div className="flex items-baseline justify-between gap-3">
        <FieldLabel id={`${uid}-docs`}>Documents</FieldLabel>
        {documents.length > 0 && (
          <span className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
            {chosen} of {documents.length}
            <button type="button" className="underline-offset-2 hover:text-foreground hover:underline" onClick={() => onAll(true)}>
              All
            </button>
            <button type="button" className="underline-offset-2 hover:text-foreground hover:underline" onClick={() => onAll(false)}>
              None
            </button>
          </span>
        )}
      </div>
      {loading ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-9" />
          ))}
        </div>
      ) : failed ? (
        <p className="text-sm text-destructive">Couldn&apos;t load this org&apos;s documents from DocuMind.</p>
      ) : documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">This org has no ready documents.</p>
      ) : (
        <div role="group" aria-labelledby={`${uid}-docs`} className="grid gap-x-4 gap-y-1 rounded-lg border p-2 sm:grid-cols-2">
          {documents.map((doc) => {
            const id = `${uid}-${doc.id}`;
            return (
              <label
                key={doc.id}
                htmlFor={id}
                className="flex min-w-0 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted"
              >
                <Checkbox id={id} checked={!excluded.has(doc.id)} onCheckedChange={(on) => onToggle(doc.id, on === true)} />
                <span className="shrink-0 font-mono text-xs whitespace-nowrap text-muted-foreground">{doc.doc_code ?? "no code"}</span>
                <span className="truncate text-sm">{doc.title}</span>
              </label>
            );
          })}
        </div>
      )}
      <FieldDescription>
        Single-hop seeds are spread over the selected documents by size, at least one each. Unanswerable and
        out-of-scope questions are checked against the whole org.
      </FieldDescription>
    </Field>
  );
}
