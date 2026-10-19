"use client";

import { ChevronDownIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { type Option, OptionSelect } from "@/components/app/option-select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import type { MetricInfo } from "@/lib/api-types";
import { GROUP_LABELS, groupMetrics, indexMetrics, metricLabel, sliceParts } from "@/lib/metrics";

const ALL = "__all";

/**
 * One row above the charts: dataset, org, run mode, retrieval mode, slice and the metrics.
 * Each is a search param, so the server reads the matching series.
 */
export function TrendFilters({
  datasets,
  orgs,
  slices,
  registry,
  value,
}: {
  datasets: Option[];
  orgs: string[];
  slices: string[];
  registry: MetricInfo[];
  value: { dataset: string | null; org: string | null; runMode: string; mode: string; slice: string; metrics: string[] };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function set(next: Record<string, string | null>) {
    const query = new URLSearchParams(params);
    for (const [key, v] of Object.entries(next)) {
      if (v && v !== ALL) query.set(key, v);
      else query.delete(key);
    }
    const qs = query.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  const runModeMetrics = registry.filter((m) => m.run_modes.includes(value.runMode));
  const sliceOptions = [...new Set(["all", ...slices])].map((s) => {
    const [kind, name] = sliceParts(s);
    return { value: s, label: s === "all" ? "All cases" : `${kind}: ${name}` };
  });

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Trend filters">
      <OptionSelect
        size="sm"
        aria-label="Dataset"
        value={value.dataset ?? ALL}
        onValueChange={(v) => set({ dataset: v })}
        options={[{ value: ALL, label: "All datasets" }, ...datasets]}
        className="min-w-40"
      />
      <OptionSelect
        size="sm"
        aria-label="Org"
        value={value.org ?? ALL}
        onValueChange={(v) => set({ org: v })}
        options={[{ value: ALL, label: "All orgs" }, ...orgs.map((o) => ({ value: o, label: o }))]}
        className="min-w-32"
      />
      <OptionSelect
        size="sm"
        aria-label="Run mode"
        value={value.runMode}
        onValueChange={(v) => set({ run_mode: v, mode: null, metrics: null })}
        options={[
          { value: "full", label: "Full runs" },
          { value: "retrieval_only", label: "Retrieval-only runs" },
        ]}
      />
      {value.runMode === "retrieval_only" && (
        <OptionSelect
          size="sm"
          aria-label="Retrieval mode"
          value={value.mode}
          onValueChange={(v) => set({ mode: v })}
          options={["hybrid", "vector", "bm25"].map((m) => ({ value: m, label: m }))}
          className="font-mono"
        />
      )}
      <OptionSelect
        size="sm"
        aria-label="Slice"
        value={value.slice}
        onValueChange={(v) => set({ slice: v === "all" ? null : v })}
        options={sliceOptions}
        className="min-w-36"
      />
      <MetricPicker
        registry={runModeMetrics}
        selected={value.metrics}
        onApply={(keys) => set({ metrics: keys.join(",") })}
      />
      {pending && <Spinner className="text-muted-foreground" aria-label="Updating" />}
    </div>
  );
}

/** A checklist of metrics, grouped; the selection applies when the popover closes. */
function MetricPicker({
  registry,
  selected,
  onApply,
}: {
  registry: MetricInfo[];
  selected: string[];
  onApply: (keys: string[]) => void;
}) {
  const [draft, setDraft] = useState<string[] | null>(null);
  const index = indexMetrics(registry);
  const keys = ["case_pass", ...registry.map((m) => m.key)];
  const groups = groupMetrics(keys, index);
  const current = draft ?? selected;

  function toggle(key: string, on: boolean) {
    setDraft((d) => {
      const base = d ?? selected;
      return on ? [...base, key] : base.filter((k) => k !== key);
    });
  }

  return (
    <Popover
      onOpenChange={(open) => {
        if (open) setDraft(selected);
        else if (draft) {
          if (draft.length && draft.join() !== selected.join()) onApply(keys.filter((k) => draft.includes(k)));
          setDraft(null);
        }
      }}
    >
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        {selected.length === 1 ? metricLabel(selected[0]) : `${selected.length} metrics`}
        <ChevronDownIcon data-icon="inline-end" />
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-[60vh] w-72 overflow-y-auto p-0">
        {groups.map(({ group, keys: groupKeys }) => (
          <fieldset key={group} className="flex flex-col border-b px-3 py-2 last:border-b-0">
            <legend className="sr-only">{GROUP_LABELS[group] ?? group}</legend>
            <span aria-hidden className="pb-1 text-xs font-semibold text-muted-foreground">
              {GROUP_LABELS[group] ?? group}
            </span>
            {groupKeys.map((key) => (
              <label key={key} className="flex items-center gap-2.5 py-1 text-sm" title={index[key]?.description}>
                <Checkbox checked={current.includes(key)} onCheckedChange={(checked) => toggle(key, !!checked)} />
                {metricLabel(key)}
              </label>
            ))}
          </fieldset>
        ))}
      </PopoverContent>
    </Popover>
  );
}
