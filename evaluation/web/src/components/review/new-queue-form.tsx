"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { createQueue } from "@/app/(app)/review/actions";
import { OptionSelect } from "@/components/app/option-select";
import { FormAlert } from "@/components/auth/form-alert";
import { runTitle } from "@/components/runs/runs-table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { REVIEWABLE_METRICS, type ReviewSampling, type RunOut } from "@/lib/api-types";
import { formatDate } from "@/lib/format";
import { metricLabel } from "@/lib/metrics";

type Metric = (typeof REVIEWABLE_METRICS)[number];

const SAMPLING: Record<ReviewSampling, string> = {
  stratified:
    "Takes cases from every score the judge gave on the first metric in turn, so a 2 is as likely to be checked as a 5. Best for calibration.",
  random: "Uniform over the run's judged cases.",
  disagreement:
    "Cases where the judge is least sure of itself: its samples disagree, or its metrics contradict each other (faithful but incorrect). Finds rubric problems; biased for calibration.",
};

export function NewQueueForm({ runs, initialRunId, initialMetric }: { runs: RunOut[]; initialRunId?: string; initialMetric?: string }) {
  const uid = useId();
  const router = useRouter();
  const [runId, setRunId] = useState(runs.some((r) => r.id === initialRunId) ? initialRunId! : (runs[0]?.id ?? ""));
  const firstMetric: Metric = REVIEWABLE_METRICS.includes(initialMetric as Metric)
    ? (initialMetric as Metric)
    : "answer_quality.correctness";
  const [primary, setPrimary] = useState<Metric>(firstMetric);
  const [others, setOthers] = useState<Set<Metric>>(new Set());
  const [sampling, setSampling] = useState<ReviewSampling>("stratified");
  const [size, setSize] = useState("30");
  const [blind, setBlind] = useState(true);
  const [seed, setSeed] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(metric: Metric, on: boolean) {
    setOthers((current) => {
      const next = new Set(current);
      if (on) next.add(metric);
      else next.delete(metric);
      return next;
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const sizeValue = Number(size);
    if (!Number.isInteger(sizeValue) || sizeValue < 1 || sizeValue > 200) {
      setError("Sample 1 to 200 cases.");
      return;
    }
    const seedValue = seed.trim() ? Number(seed) : null;
    if (seedValue !== null && (!Number.isInteger(seedValue) || seedValue < 0)) {
      setError("The seed must be a whole number.");
      return;
    }
    if (!runId) {
      setError("Pick a judged run.");
      return;
    }
    startTransition(async () => {
      const result = await createQueue({
        run_id: runId,
        name: name.trim() || null,
        metrics: [primary, ...REVIEWABLE_METRICS.filter((m) => m !== primary && others.has(m))],
        sampling,
        size: sizeValue,
        blind,
        seed: seedValue,
      });
      if (!result.ok) {
        setError(result.error);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      const picked = result.data.progress?.total ?? result.data.size;
      toast.success(`${picked} case${picked === 1 ? "" : "s"} queued for review.`);
      router.push(`/review/${result.data.id}`);
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-10" noValidate>
      <FormAlert message={error} />
      <FieldSet>
        <FieldLegend>What to grade</FieldLegend>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${uid}-run`}>Run</FieldLabel>
            <OptionSelect
              id={`${uid}-run`}
              value={runId}
              onValueChange={setRunId}
              options={runs.map((r) => ({ value: r.id, label: `${runTitle(r)} · ${formatDate(r.created_at)}` }))}
              placeholder="No judged runs yet"
              disabled={!runs.length}
              className="w-full"
            />
            <FieldDescription>Completed full runs with the judge on. Grades belong to the run&apos;s cases, so they count in every queue over it.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${uid}-primary`}>Metric</FieldLabel>
            <OptionSelect
              id={`${uid}-primary`}
              value={primary}
              onValueChange={(v) => {
                setPrimary(v as Metric);
                toggle(v as Metric, false);
              }}
              options={REVIEWABLE_METRICS.map((m) => ({ value: m, label: metricLabel(m) }))}
              className="w-full sm:w-80"
            />
            <FieldDescription>Stratified sampling spreads the queue over the judge&apos;s scores for this one.</FieldDescription>
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Also grade</legend>
            <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {REVIEWABLE_METRICS.filter((m) => m !== primary).map((m) => (
                <label key={m} htmlFor={`${uid}-also-${m}`} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted">
                  <Checkbox id={`${uid}-also-${m}`} checked={others.has(m)} onCheckedChange={(on) => toggle(m, on === true)} />
                  <span className="text-sm">{metricLabel(m)}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Each case shows only the metrics the judge scored on it (correctness needs a reference answer).
            </p>
          </fieldset>
        </FieldGroup>
      </FieldSet>

      <FieldSet>
        <FieldLegend>Sample</FieldLegend>
        <FieldGroup>
          <Field>
            <FieldLabel id={`${uid}-sampling`}>Sampling</FieldLabel>
            <ToggleGroup
              aria-labelledby={`${uid}-sampling`}
              variant="outline"
              size="sm"
              spacing={0}
              value={[sampling]}
              onValueChange={(v: string[]) => v[0] && setSampling(v[0] as ReviewSampling)}
            >
              <ToggleGroupItem value="stratified">Stratified</ToggleGroupItem>
              <ToggleGroupItem value="random">Random</ToggleGroupItem>
              <ToggleGroupItem value="disagreement">Disagreement</ToggleGroupItem>
            </ToggleGroup>
            <FieldDescription className="max-w-[65ch]">{SAMPLING[sampling]}</FieldDescription>
          </Field>
          <div className="grid gap-5 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor={`${uid}-size`}>Cases</FieldLabel>
              <Input
                id={`${uid}-size`}
                type="number"
                inputMode="numeric"
                min={1}
                max={200}
                value={size}
                onChange={(e) => setSize(e.target.value)}
                className="w-24 font-mono tabular-nums"
              />
              <FieldDescription>30 graded cases can reach &ldquo;calibrated&rdquo;.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${uid}-seed`}>Seed</FieldLabel>
              <Input
                id={`${uid}-seed`}
                inputMode="numeric"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                placeholder="random"
                className="w-32 font-mono tabular-nums"
              />
              <FieldDescription>The same seed picks the same cases.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${uid}-name`}>Name</FieldLabel>
              <Input id={`${uid}-name`} value={name} onChange={(e) => setName(e.target.value)} placeholder="optional" maxLength={200} />
            </Field>
          </div>
          <Field orientation="horizontal">
            <Switch id={`${uid}-blind`} checked={blind} onCheckedChange={setBlind} />
            <FieldContent>
              <FieldLabel htmlFor={`${uid}-blind`}>Blind</FieldLabel>
              <FieldDescription>
                Hide the judge&apos;s grades and reasoning until you submit yours; then they show, and your grades lock.
                Turn off only for training, never for calibration.
              </FieldDescription>
            </FieldContent>
          </Field>
        </FieldGroup>
      </FieldSet>

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={pending || !runs.length}>
          {pending && <Spinner data-icon="inline-start" />}
          {pending ? "Sampling…" : "Create queue"}
        </Button>
      </div>
    </form>
  );
}
