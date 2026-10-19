"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { createRun } from "@/app/(app)/runs/actions";
import { type Option, OptionSelect } from "@/components/app/option-select";
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
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { type MetricInfo, type OrgAccess, RETRIEVAL_MODES, type RetrievalMode } from "@/lib/api-types";
import { estimateRunCost } from "@/lib/cost";
import { formatCost } from "@/lib/format";
import { GROUP_LABELS, GROUP_ORDER, metricLabel } from "@/lib/metrics";
import { DEFAULT_JUDGE, type JudgeConfig, JudgeFields } from "./judge-fields";

export type DatasetVersionOption = {
  id: string;
  label: string;
  slug: string;
  version: number;
  cases: number;
  defaultOrg: string | null;
};

const DEFAULT = "__default";

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function NewRunForm({
  versions,
  initialVersionId,
  orgs,
  registry,
  judgeModels,
  chatModels,
  defaults,
}: {
  versions: DatasetVersionOption[];
  initialVersionId: string;
  orgs: OrgAccess[];
  registry: MetricInfo[];
  judgeModels: string[];
  chatModels: string[];
  defaults: Record<string, unknown>;
}) {
  const uid = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [versionId, setVersionId] = useState(initialVersionId);
  const version = versions.find((v) => v.id === versionId) ?? versions[0];
  const [org, setOrg] = useState(version.defaultOrg ?? orgs[0]?.slug ?? "");
  const [mode, setMode] = useState<"full" | "retrieval_only">("full");
  const [name, setName] = useState("");
  const [tags, setTags] = useState("");

  const [topK, setTopK] = useState("");
  const [retrievalMode, setRetrievalMode] = useState(DEFAULT);
  const [chatModel, setChatModel] = useState(DEFAULT);
  const [routerModel, setRouterModel] = useState(DEFAULT);
  const [tier, setTier] = useState(DEFAULT);
  const [retrievalModes, setRetrievalModes] = useState<RetrievalMode[]>([...RETRIEVAL_MODES]);

  const applicable = useMemo(() => registry.filter((m) => m.run_modes.includes(mode)), [registry, mode]);
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [gates, setGates] = useState<Set<string>>(() => new Set(registry.filter((m) => m.gating).map((m) => m.key)));
  const [gatesTouched, setGatesTouched] = useState(false);
  const [thresholds, setThresholds] = useState<Record<string, string>>({});

  const [judge, setJudge] = useState<JudgeConfig>(DEFAULT_JUDGE);
  const [budget, setBudget] = useState("1");
  const [cleanup, setCleanup] = useState(true);

  const enabledKeys = applicable.filter((m) => !disabled.has(m.key)).map((m) => m.key);
  const allEnabled = enabledKeys.length === applicable.length;
  const judgeOn = mode === "full" && judge.enabled;

  const estimate = estimateRunCost({
    cases: version.cases,
    mode,
    retrievalModes: retrievalModes.length,
    judgeEnabled: judgeOn,
    enabled: allEnabled ? null : enabledKeys,
    rubricModel: judge.models.rubric,
    samples: judge.samples,
  });

  const grouped = GROUP_ORDER.map((group) => ({ group, metrics: applicable.filter((m) => m.group === group) })).filter(
    (g) => g.metrics.length,
  );

  function toggleMetric(key: string, on: boolean) {
    setDisabled((current) => {
      const next = new Set(current);
      if (on) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleGate(key: string, on: boolean) {
    setGatesTouched(true);
    setGates((current) => {
      const next = new Set(current);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function chooseVersion(id: string) {
    setVersionId(id);
    const next = versions.find((v) => v.id === id);
    if (next?.defaultOrg) setOrg(next.defaultOrg);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsedThresholds: Record<string, number> = {};
    for (const [key, raw] of Object.entries(thresholds)) {
      if (!raw.trim()) continue;
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        setError(`The threshold for ${metricLabel(key)} isn't a number.`);
        return;
      }
      parsedThresholds[key] = value;
    }
    const k = topK.trim() ? Number(topK) : null;
    if (k !== null && (!Number.isInteger(k) || k < 1 || k > 30)) {
      setError("Top k must be a whole number from 1 to 30.");
      return;
    }
    const pick = (value: string) => (value === DEFAULT ? null : value);
    startTransition(async () => {
      const result = await createRun({
        dataset_version_id: versionId,
        org_slug: org || null,
        mode,
        overrides: {
          top_k: k,
          retrieval_mode: mode === "full" ? (pick(retrievalMode) as RetrievalMode | null) : null,
          chat_model: mode === "full" ? pick(chatModel) : null,
          router_model: pick(routerModel),
          chat_service_tier: pick(tier) as "standard" | "flex" | "auto" | null,
        },
        retrieval_modes: mode === "retrieval_only" ? retrievalModes : null,
        metrics: {
          enabled: allEnabled ? null : enabledKeys,
          thresholds: parsedThresholds,
          gates: gatesTouched ? [...gates].filter((g) => enabledKeys.includes(g)) : null,
        },
        judge: { ...judge, enabled: judgeOn },
        name: name.trim() || null,
        tags: splitList(tags),
        max_judge_cost_usd: judgeOn && budget.trim() ? Number(budget) : null,
        cleanup_conversations: cleanup,
      });
      if (!result.ok) {
        setError(result.error);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      toast.success("Run started.");
      router.push(`/runs/${result.data.id}`);
    });
  }

  const modelOptions = (fallback: unknown): Option[] => [
    { value: DEFAULT, label: `DocuMind default (${String(fallback ?? "org setting")})` },
    ...chatModels.map((m) => ({ value: m, label: m })),
  ];

  return (
    <form onSubmit={submit} className="flex flex-col gap-10" noValidate>
      <FormAlert message={error} />

      <FieldSet>
        <FieldLegend>What to run</FieldLegend>
        <FieldGroup>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={`${uid}-version`}>Dataset version</FieldLabel>
              <OptionSelect
                id={`${uid}-version`}
                value={versionId}
                onValueChange={chooseVersion}
                options={versions.map((v) => ({ value: v.id, label: `${v.label} (${v.cases} cases)` }))}
                className="w-full"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${uid}-org`}>Organization</FieldLabel>
              {orgs.length ? (
                <OptionSelect
                  id={`${uid}-org`}
                  value={org}
                  onValueChange={setOrg}
                  options={orgs.map((o) => ({ value: o.slug, label: `${o.name} (${o.slug})` }))}
                  className="w-full"
                />
              ) : (
                <Input id={`${uid}-org`} value={org} onChange={(e) => setOrg(e.target.value)} className="font-mono" />
              )}
              <FieldDescription>The DocuMind org whose documents answer the questions.</FieldDescription>
            </Field>
          </div>
          <Field>
            <FieldLabel id={`${uid}-mode`}>Mode</FieldLabel>
            <ToggleGroup
              aria-labelledby={`${uid}-mode`}
              variant="outline"
              size="sm"
              spacing={0}
              value={[mode]}
              onValueChange={(v: string[]) => v[0] && setMode(v[0] as "full" | "retrieval_only")}
            >
              <ToggleGroupItem value="full">Full (answers + judge)</ToggleGroupItem>
              <ToggleGroupItem value="retrieval_only">Retrieval only</ToggleGroupItem>
            </ToggleGroup>
            <FieldDescription>
              {mode === "full"
                ? "Asks DocuMind each question as a chat, then scores retrieval, the answer and its citations."
                : "Calls DocuMind's retrieve endpoint only: no answers, no judge, a fraction of the cost."}
            </FieldDescription>
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={`${uid}-name`}>Name</FieldLabel>
              <Input
                id={`${uid}-name`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`${version.slug} v${version.version}, ${mode === "full" ? "full" : "retrieval"}`}
                maxLength={200}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${uid}-tags`}>Tags</FieldLabel>
              <Input id={`${uid}-tags`} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="baseline, top-k-12" />
              <FieldDescription>Comma-separated; the runs list filters by tag.</FieldDescription>
            </Field>
          </div>
        </FieldGroup>
      </FieldSet>

      <FieldSet>
        <FieldLegend>DocuMind overrides</FieldLegend>
        <FieldDescription>Leave a field on its default to use the org&apos;s own setting.</FieldDescription>
        <FieldGroup>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={`${uid}-topk`}>Top k</FieldLabel>
              <Input
                id={`${uid}-topk`}
                type="number"
                min={1}
                max={30}
                inputMode="numeric"
                placeholder={`Default (${String(defaults.top_k ?? 8)})`}
                value={topK}
                onChange={(e) => setTopK(e.target.value)}
                className="font-mono"
              />
            </Field>
            {mode === "full" ? (
              <Field>
                <FieldLabel htmlFor={`${uid}-rmode`}>Retrieval</FieldLabel>
                <OptionSelect
                  id={`${uid}-rmode`}
                  value={retrievalMode}
                  onValueChange={setRetrievalMode}
                  options={[{ value: DEFAULT, label: "Default (hybrid)" }, ...RETRIEVAL_MODES.map((m) => ({ value: m, label: m }))]}
                  className="w-full"
                />
              </Field>
            ) : (
              <FieldSet>
                <FieldLegend variant="label">Retrieval modes</FieldLegend>
                <div className="flex flex-wrap gap-4 pt-1">
                  {RETRIEVAL_MODES.map((m) => (
                    <Field key={m} orientation="horizontal" className="w-auto">
                      <Checkbox
                        id={`${uid}-rm-${m}`}
                        checked={retrievalModes.includes(m)}
                        onCheckedChange={(checked) =>
                          setRetrievalModes((current) =>
                            checked ? RETRIEVAL_MODES.filter((x) => x === m || current.includes(x)) : current.filter((x) => x !== m),
                          )
                        }
                      />
                      <FieldLabel htmlFor={`${uid}-rm-${m}`} className="font-mono">
                        {m}
                      </FieldLabel>
                    </Field>
                  ))}
                </div>
              </FieldSet>
            )}
            {mode === "full" && (
              <Field>
                <FieldLabel htmlFor={`${uid}-chat`}>Chat model</FieldLabel>
                <OptionSelect
                  id={`${uid}-chat`}
                  value={chatModel}
                  onValueChange={setChatModel}
                  options={modelOptions(defaults.chat_model)}
                  className="w-full"
                />
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor={`${uid}-router`}>Router model</FieldLabel>
              <OptionSelect
                id={`${uid}-router`}
                value={routerModel}
                onValueChange={setRouterModel}
                options={modelOptions(defaults.router_model)}
                className="w-full"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${uid}-tier`}>Service tier</FieldLabel>
              <OptionSelect
                id={`${uid}-tier`}
                value={tier}
                onValueChange={setTier}
                options={[
                  { value: DEFAULT, label: `Default (${String(defaults.chat_service_tier ?? "standard")})` },
                  { value: "standard", label: "standard" },
                  { value: "flex", label: "flex (cheaper, slower)" },
                  { value: "auto", label: "auto" },
                ]}
                className="w-full"
              />
            </Field>
          </div>
        </FieldGroup>
      </FieldSet>

      <FieldSet>
        <FieldLegend>Metrics and gates</FieldLegend>
        <FieldDescription>
          A case passes only if every gate that applies passes. Thresholds override the defaults for this run.
        </FieldDescription>
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  Metric
                </th>
                <th scope="col" className="w-20 px-3 py-2 text-center font-medium">
                  Gate
                </th>
                <th scope="col" className="w-32 px-3 py-2 text-right font-medium">
                  Threshold
                </th>
              </tr>
            </thead>
            {grouped.map(({ group, metrics }) => (
              <tbody key={group} className="border-b last:border-b-0">
                <tr>
                  <th colSpan={3} scope="colgroup" className="bg-muted/30 px-3 py-1.5 text-left text-xs font-semibold text-muted-foreground">
                    {GROUP_LABELS[group] ?? group}
                  </th>
                </tr>
                {metrics.map((m) => {
                  const on = !disabled.has(m.key);
                  const needsJudge = m.requires_judge && !judgeOn;
                  return (
                    <tr key={m.key} className="border-t first:border-t-0">
                      <td className="px-3 py-1.5">
                        <label className="flex items-center gap-2.5" title={m.description}>
                          <Checkbox checked={on} onCheckedChange={(checked) => toggleMetric(m.key, !!checked)} />
                          <span className={needsJudge ? "text-muted-foreground" : undefined}>{metricLabel(m.key)}</span>
                          {needsJudge && <span className="text-xs text-muted-foreground">needs the judge</span>}
                        </label>
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <Switch
                          size="sm"
                          aria-label={`Gate on ${metricLabel(m.key)}`}
                          checked={gates.has(m.key) && on}
                          disabled={!on}
                          onCheckedChange={(checked) => toggleGate(m.key, checked)}
                        />
                      </td>
                      <td className="px-3 py-1">
                        <Input
                          aria-label={`Threshold for ${metricLabel(m.key)}`}
                          inputMode="decimal"
                          placeholder={m.default_threshold === null ? "" : String(m.default_threshold)}
                          value={thresholds[m.key] ?? ""}
                          onChange={(e) => setThresholds((t) => ({ ...t, [m.key]: e.target.value }))}
                          disabled={!on}
                          className="h-7 text-right font-mono text-xs"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
      </FieldSet>

      {mode === "full" && (
        <FieldSet>
          <FieldLegend>Judge</FieldLegend>
          <FieldGroup>
            <Field orientation="horizontal">
              <Switch
                id={`${uid}-judge`}
                checked={judge.enabled}
                onCheckedChange={(checked) => setJudge((j) => ({ ...j, enabled: checked }))}
              />
              <FieldContent>
                <FieldLabel htmlFor={`${uid}-judge`}>Judge the answers with Claude</FieldLabel>
                <FieldDescription>Off = deterministic metrics only (retrieval, citations, safety, cost).</FieldDescription>
              </FieldContent>
            </Field>
            {judge.enabled && (
              <>
                <JudgeFields value={judge} onChange={setJudge} models={judgeModels} />
                <Field className="sm:max-w-xs">
                  <FieldLabel htmlFor={`${uid}-budget`}>Judge budget (USD)</FieldLabel>
                  <Input
                    id={`${uid}-budget`}
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    placeholder="No limit"
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    className="font-mono"
                  />
                  <FieldDescription>The run pauses itself when judge spend reaches this.</FieldDescription>
                </Field>
              </>
            )}
          </FieldGroup>
        </FieldSet>
      )}

      <Field orientation="horizontal">
        <Switch id={`${uid}-cleanup`} checked={cleanup} onCheckedChange={setCleanup} />
        <FieldContent>
          <FieldLabel htmlFor={`${uid}-cleanup`}>Delete the eval conversations in DocuMind when the run ends</FieldLabel>
          <FieldDescription>Scores and answers are kept here either way; DocuMind&apos;s usage records stay too.</FieldDescription>
        </FieldContent>
      </Field>

      <div className="sticky bottom-0 -mx-5 flex flex-wrap items-center justify-between gap-4 border-t bg-background/95 px-5 py-4 md:-mx-10 md:px-10">
        <p className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
          Estimated cost for {version.cases} cases:{" "}
          <span className="font-mono text-foreground">≈ {formatCost(estimate.total)}</span>
          <span className="block text-xs">
            DocuMind {formatCost(estimate.documind)} · judge {formatCost(estimate.judge)}. Metered actuals replace this.
          </span>
        </p>
        <Button type="submit" size="lg" disabled={pending || (mode === "retrieval_only" && retrievalModes.length === 0)}>
          {pending && <Spinner data-icon="inline-start" />}
          {pending ? "Starting…" : "Start run"}
        </Button>
      </div>
    </form>
  );
}
