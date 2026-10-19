"use client";

import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { OptionSelect } from "@/components/app/option-select";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RUN_CASE_STATUSES, type RunCaseOut } from "@/lib/api-types";
import { formatDuration, formatUnitCost, humanize } from "@/lib/format";
import { formatMetric, type MetricIndex, metricLabel } from "@/lib/metrics";
import { cn } from "@/lib/utils";
import { CaseStatusBadge, PassMark } from "./status";

type SortKey = "case" | "result" | "latency" | "cost" | `m:${string}`;
type Sort = { key: SortKey; dir: "asc" | "desc" };

const ALL = "__all";
// Metric columns appear as the table's own width allows (the sidebar eats 256px).
const METRIC_COLUMN_AT = ["@2xl:table-cell", "@3xl:table-cell", "@4xl:table-cell", "@4xl:table-cell"];

function sortValue(c: RunCaseOut, key: SortKey, mode: string): number | string | null {
  switch (key) {
    case "case":
      return c.case_key;
    case "result":
      // Pass > fail > still running / errored (by status order).
      return c.status === "done" && c.passed !== null ? 10 + Number(c.passed) : RUN_CASE_STATUSES.indexOf(c.status);
    case "latency":
      return c.latency_ms;
    case "cost":
      return c.documind_cost_usd;
    default:
      return c.metrics[mode]?.[key.slice(2)] ?? null;
  }
}

export function CaseTable({
  runId,
  cases,
  mode,
  columns,
  index,
}: {
  runId: string;
  cases: RunCaseOut[];
  mode: string;
  /** Metric columns, by key. */
  columns: string[];
  index: MetricIndex;
}) {
  const [sort, setSort] = useState<Sort>({ key: "case", dir: "asc" });
  const [status, setStatus] = useState(ALL);
  const [type, setType] = useState(ALL);
  const [result, setResult] = useState(ALL);
  const [query, setQuery] = useState("");

  const types = useMemo(() => [...new Set(cases.map((c) => c.type).filter(Boolean))].sort() as string[], [cases]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = cases.filter(
      (c) =>
        (status === ALL || c.status === status) &&
        (type === ALL || c.type === type) &&
        (result === ALL || (result === "pass" ? c.passed === true : result === "fail" ? c.passed === false : c.passed === null)) &&
        (!q || c.case_key.toLowerCase().includes(q) || (c.question ?? "").toLowerCase().includes(q)),
    );
    const dir = sort.dir === "asc" ? 1 : -1;
    return filtered.toSorted((a, b) => {
      const va = sortValue(a, sort.key, mode);
      const vb = sortValue(b, sort.key, mode);
      // Missing values sink to the bottom either way.
      if (va === null || va === undefined) return vb === null || vb === undefined ? 0 : 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === "string" || typeof vb === "string") return String(va).localeCompare(String(vb), "en", { numeric: true }) * dir;
      return (va - vb) * dir;
    });
  }, [cases, status, type, result, query, sort, mode]);

  function header(key: SortKey, label: string, className?: string) {
    const active = sort.key === key;
    const Icon = !active ? ChevronsUpDownIcon : sort.dir === "asc" ? ArrowUpIcon : ArrowDownIcon;
    return (
      <TableHead key={key} className={className} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
        <button
          type="button"
          onClick={() => setSort({ key, dir: active && sort.dir === "asc" ? "desc" : active ? "asc" : key === "case" ? "asc" : "desc" })}
          className="-mx-1 inline-flex items-center gap-1 rounded-sm px-1 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {label}
          <Icon className={cn("size-3", !active && "opacity-40")} aria-hidden />
        </button>
      </TableHead>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Case filters">
        <InputGroup className="w-56">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search cases"
            placeholder="Search key or question"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </InputGroup>
        <OptionSelect
          size="sm"
          aria-label="Result"
          value={result}
          onValueChange={setResult}
          options={[
            { value: ALL, label: "Any result" },
            { value: "pass", label: "Passed" },
            { value: "fail", label: "Failed" },
            { value: "none", label: "No result yet" },
          ]}
        />
        <OptionSelect
          size="sm"
          aria-label="Status"
          value={status}
          onValueChange={setStatus}
          options={[{ value: ALL, label: "Any status" }, ...RUN_CASE_STATUSES.map((s) => ({ value: s, label: humanize(s) }))]}
        />
        <OptionSelect
          size="sm"
          aria-label="Type"
          value={type}
          onValueChange={setType}
          options={[{ value: ALL, label: "Any type" }, ...types.map((t) => ({ value: t, label: humanize(t) }))]}
        />
        <span className="ml-auto text-sm text-muted-foreground tabular-nums">
          {rows.length === cases.length ? `${cases.length} cases` : `${rows.length} of ${cases.length} cases`}
        </span>
      </div>
      <div className="@container overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {header("case", "Case")}
              {header("result", "Result")}
              {columns.map((key, i) => header(`m:${key}`, metricLabel(key), cn("hidden text-right", METRIC_COLUMN_AT[i])))}
              {header("latency", "Latency", "hidden text-right @5xl:table-cell")}
              {header("cost", "Cost", "hidden text-right @5xl:table-cell")}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4 + columns.length} className="py-8 text-center text-sm text-muted-foreground">
                  No cases match these filters.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="max-w-0 min-w-56 @xl:max-w-sm">
                    <Link
                      href={`/runs/${runId}/cases/${c.id}`}
                      className="flex min-w-0 flex-col gap-0.5 rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-xs font-medium hover:underline">{c.case_key}</span>
                        {c.type && <span className="text-xs text-muted-foreground">{humanize(c.type)}</span>}
                      </span>
                      <span className="truncate text-sm text-muted-foreground">{c.question}</span>
                      {c.error && <span className="truncate text-xs text-destructive">{c.error_stage}: {c.error}</span>}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {c.status === "done" ? <PassMark passed={c.passed} /> : <CaseStatusBadge status={c.status} />}
                  </TableCell>
                  {columns.map((key, i) => (
                    <TableCell key={key} className={cn("hidden text-right font-mono text-xs tabular-nums", METRIC_COLUMN_AT[i])}>
                      {formatMetric(c.metrics[mode]?.[key], index[key], { single: true })}
                    </TableCell>
                  ))}
                  <TableCell className="hidden text-right text-xs text-muted-foreground tabular-nums @5xl:table-cell">
                    {formatDuration(c.latency_ms)}
                  </TableCell>
                  <TableCell className="hidden text-right text-xs text-muted-foreground tabular-nums @5xl:table-cell">
                    {c.documind_cost_usd === null ? "n/a" : formatUnitCost(c.documind_cost_usd)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
