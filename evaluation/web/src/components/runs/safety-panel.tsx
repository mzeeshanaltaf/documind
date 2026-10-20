"use client";

import { CircleAlertIcon, CircleCheckIcon, CircleXIcon } from "lucide-react";
import Link from "next/link";
import useSWR from "swr";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ProbeResult, SafetyCase, SafetyMetric, SafetySummary } from "@/lib/api-types";
import { cn } from "@/lib/utils";

function formatPercent(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

const ADVERSARIAL = ["injection_resisted", "refusal_rate_oos", "jurisdiction_confusion", "authz_probe"];

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return (await response.json()) as T;
}

/** Whether a run has anything for the panel: adversarial cases, or a leak in any run. */
export function hasSafetyContent(summary: SafetySummary | undefined): boolean {
  if (!summary) return false;
  const m = summary.metrics;
  if ((m.leakage?.bad ?? 0) > 0 || summary.probe_errors.length > 0) return true;
  return ADVERSARIAL.some((key) => (m[key]?.n ?? 0) + (m[key]?.errors ?? 0) > 0);
}

export function SafetyPanel({ runId, initial, live }: { runId: string; initial: SafetySummary | null; live: boolean }) {
  const { data } = useSWR(`/api/backend/runs/${runId}/safety`, getJson<SafetySummary>, {
    fallbackData: initial ?? undefined,
    refreshInterval: live ? 5000 : 0,
    revalidateOnFocus: false,
  });
  if (!data || !hasSafetyContent(data)) return null;
  const m = data.metrics;
  const findings = collectFindings(data);

  return (
    <section aria-labelledby="safety-title" className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <h2 id="safety-title" className="font-sans text-sm font-semibold">
          Safety
        </h2>
        <p className="text-xs text-muted-foreground">
          Leakage must be 0 and every authz probe must pass. Injection and refusal rates read the behaviour judge where
          it ran.
        </p>
      </header>

      <dl className="grid overflow-hidden rounded-lg border sm:grid-cols-2 lg:grid-cols-5">
        <Tally
          label="Leakage"
          metric={m.leakage}
          value={m.leakage?.bad ?? 0}
          unit={(m.leakage?.bad ?? 0) === 1 ? "leak" : "leaks"}
          of={m.leakage?.n}
          tone={(m.leakage?.bad ?? 0) > 0 ? "danger" : "success"}
          note="must be 0"
        />
        <Tally
          label="Injection resisted"
          metric={m.injection_resisted}
          value={(m.injection_resisted?.n ?? 0) - (m.injection_resisted?.bad ?? 0)}
          of={m.injection_resisted?.n}
          rate={m.injection_resisted?.mean}
          tone={(m.injection_resisted?.bad ?? 0) > 0 ? "danger" : "success"}
        />
        <Tally
          label="Out-of-scope refusals"
          metric={m.refusal_rate_oos}
          value={(m.refusal_rate_oos?.n ?? 0) - (m.refusal_rate_oos?.bad ?? 0)}
          of={m.refusal_rate_oos?.n}
          rate={m.refusal_rate_oos?.mean}
          tone={(m.refusal_rate_oos?.bad ?? 0) > 0 ? "warning" : "success"}
          note={m.refusal_rate_oos && m.refusal_rate_oos.n === 0 ? "needs the judge" : undefined}
        />
        <Tally
          label="Authz probes passed"
          metric={m.authz_probe}
          value={(m.authz_probe?.n ?? 0) - (m.authz_probe?.bad ?? 0)}
          of={(m.authz_probe?.n ?? 0) + data.probe_errors.length}
          tone={(m.authz_probe?.bad ?? 0) + data.probe_errors.length > 0 ? "danger" : "success"}
          note={data.probe_errors.length ? `${data.probe_errors.length} couldn't run` : "must all pass"}
        />
        <Tally
          label="Jurisdiction confusion"
          metric={m.jurisdiction_confusion}
          value={m.jurisdiction_confusion?.bad ?? 0}
          unit={(m.jurisdiction_confusion?.bad ?? 0) === 1 ? "case" : "cases"}
          of={m.jurisdiction_confusion?.n}
          tone={(m.jurisdiction_confusion?.bad ?? 0) > 0 ? "warning" : "success"}
        />
      </dl>

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground">Findings</h3>
        {findings.length === 0 ? (
          <p className="text-sm text-muted-foreground">No safety findings in the cases scored so far.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {findings.map((f) => (
              <li
                key={`${f.metric}-${f.case.run_case_id}`}
                className="flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-baseline sm:gap-4"
              >
                <span
                  className={cn("inline-flex w-44 shrink-0 items-center gap-1.5 text-xs font-medium", TONE[f.tone])}
                >
                  <CircleAlertIcon className="size-3.5" aria-hidden />
                  {f.label}
                </span>
                <span className="min-w-0 flex-1 text-sm">
                  <Link
                    href={`/runs/${runId}/cases/${f.case.run_case_id}`}
                    className="font-mono text-xs hover:underline"
                  >
                    {f.case.case_key}
                  </Link>
                  <span className="ml-2 text-muted-foreground">{f.reason}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {(m.authz_probe?.cases.length ?? 0) > 0 && <ProbeTable runId={runId} cases={m.authz_probe!.cases} />}
    </section>
  );
}

type Tone = "danger" | "warning" | "success";
const TONE: Record<Tone, string> = {
  danger: "text-destructive",
  warning: "text-warning",
  success: "text-success",
};

function Tally({
  label,
  metric,
  value,
  unit,
  of,
  rate,
  tone,
  note,
}: {
  label: string;
  metric: SafetyMetric | undefined;
  value: number;
  unit?: string;
  of: number | undefined;
  rate?: number | null;
  tone: Tone;
  note?: string;
}) {
  const scored = (of ?? 0) > 0;
  const Icon = tone === "success" ? CircleCheckIcon : tone === "danger" ? CircleXIcon : CircleAlertIcon;
  return (
    <div className="flex flex-col gap-1 border-b p-4 last:border-b-0 sm:border-r lg:border-b-0 lg:last:border-r-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="flex flex-col gap-0.5">
        {scored ? (
          <span className={cn("inline-flex items-center gap-1.5 font-mono text-lg tabular-nums", TONE[tone])}>
            <Icon className="size-4" aria-hidden />
            {unit ? `${value} ${unit}` : `${value} of ${of}`}
          </span>
        ) : (
          <span className="font-mono text-lg text-muted-foreground">n/a</span>
        )}
        <span className="text-xs text-muted-foreground tabular-nums">
          {[
            unit && scored ? `over ${of} case${of === 1 ? "" : "s"}` : null,
            rate !== undefined && rate !== null ? formatPercent(rate) : null,
            metric?.errors ? `${metric.errors} unscored` : null,
            note,
          ]
            .filter(Boolean)
            .join(" · ") || " "}
        </span>
      </dd>
    </div>
  );
}

type Finding = {
  metric: string;
  label: string;
  tone: Tone;
  case: SafetyCase;
  reason: string;
};

const LABEL: Record<string, string> = {
  leakage: "Leak",
  injection_resisted: "Injection followed",
  refusal_rate_oos: "Didn't refuse",
  jurisdiction_confusion: "Jurisdiction confusion",
  authz_probe: "Probe failed",
  behavior_correct: "Wrong behaviour",
  followup_resolution: "Follow-up unresolved",
};

function collectFindings(summary: SafetySummary): Finding[] {
  const order = [
    "leakage",
    "authz_probe",
    "injection_resisted",
    "refusal_rate_oos",
    "jurisdiction_confusion",
    "followup_resolution",
    "behavior_correct",
  ];
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const metric of order) {
    for (const c of summary.metrics[metric]?.cases ?? []) {
      if (!c.bad) continue;
      // A wrong behaviour on a case already listed for its safety metric adds nothing.
      if (metric === "behavior_correct" && seen.has(c.run_case_id)) continue;
      seen.add(c.run_case_id);
      const tone: Tone =
        metric === "leakage" || metric === "authz_probe" || metric === "injection_resisted" ? "danger" : "warning";
      findings.push({
        metric,
        label: LABEL[metric] ?? metric,
        tone,
        case: c,
        reason: reasonOf(metric, c),
      });
    }
  }
  for (const c of summary.probe_errors) {
    findings.push({
      metric: "probe_error",
      label: "Probe couldn't run",
      tone: "danger",
      case: c,
      reason: String(c.details.error ?? ""),
    });
  }
  return findings;
}

function reasonOf(metric: string, c: SafetyCase): string {
  const d = c.details as Record<string, unknown>;
  switch (metric) {
    case "leakage": {
      const reasons = (d.reasons as Record<string, string>[] | undefined) ?? [];
      return reasons
        .map((r) =>
          r.kind === "canary"
            ? `canary "${r.phrase}" in the ${r.where}`
            : r.kind === "foreign_document"
              ? `source from another org${r.doc_code ? ` (${r.doc_code})` : ""}`
              : `${r.doc_code} ${r.kind === "forbidden_source" ? "retrieved" : r.kind === "forbidden_citation" ? "cited" : "named in the answer"}`,
        )
        .join("; ");
    }
    case "injection_resisted": {
      const parts: string[] = [];
      const canary = (d.canary_hits as string[] | undefined) ?? [];
      const prints = (d.fingerprint_hits as string[] | undefined) ?? [];
      if (canary.length) parts.push(`canary ${canary.join(", ")} in the answer`);
      if (prints.length)
        parts.push(`${prints.length} system-prompt phrase${prints.length === 1 ? "" : "s"} in the answer`);
      const judge = d.judge as
        { behavior?: string; followed_injected_instruction?: boolean } | string | null | undefined;
      if (
        judge &&
        typeof judge === "object" &&
        (judge.behavior === "followed_injection" || judge.followed_injected_instruction)
      ) {
        parts.push("the judge says it followed the injected instruction");
      }
      return parts.join("; ") || c.question;
    }
    case "refusal_rate_oos":
      return `answered as ${String(d.behavior ?? "?")}: ${c.question}`;
    case "jurisdiction_confusion": {
      const cited = (d.citations as { doc_code: string; jurisdiction: string }[] | undefined) ?? [];
      return `asked about ${String(d.expected ?? "?")}, cites ${cited.map((x) => `${x.doc_code} (${x.jurisdiction})`).join(", ")} without naming it`;
    }
    case "authz_probe": {
      const failed = ((d.requests as ProbeResult[] | undefined) ?? []).filter((r) => !r.ok);
      return failed.map((r) => `${r.name}: expected ${r.expect}, got ${r.status ?? "no response"}`).join("; ");
    }
    case "behavior_correct":
      return `${String(d.behavior ?? "?")}, expected ${String(d.expected ?? "?")}`;
    case "followup_resolution":
      return `standalone query: ${String(d.standalone_query ?? "none")}`;
  }
  return "";
}

function ProbeTable({ runId, cases }: { runId: string; cases: SafetyCase[] }) {
  const rows = cases.flatMap((c) =>
    ((c.details.requests as ProbeResult[] | undefined) ?? []).map((r, i) => ({
      c,
      r,
      first: i === 0,
    })),
  );
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold text-muted-foreground">Authz probe requests</h3>
      <div className="@container overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Case</TableHead>
              <TableHead>Request</TableHead>
              <TableHead className="hidden @2xl:table-cell">Path</TableHead>
              <TableHead className="text-right">Expected</TableHead>
              <TableHead className="text-right">Got</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ c, r, first }) => (
              <TableRow key={`${c.run_case_id}-${r.name}`}>
                <TableCell className="align-top">
                  {first && (
                    <Link href={`/runs/${runId}/cases/${c.run_case_id}`} className="font-mono text-xs hover:underline">
                      {c.case_key}
                    </Link>
                  )}
                </TableCell>
                <TableCell className="min-w-36 text-sm whitespace-normal">{r.name}</TableCell>
                <TableCell
                  className="hidden max-w-80 truncate font-mono text-xs text-muted-foreground @2xl:table-cell"
                  title={r.path}
                >
                  {r.method} {r.path}
                </TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{r.expect}</TableCell>
                <TableCell className="text-right">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 font-mono text-xs tabular-nums",
                      r.ok ? "text-success" : "text-destructive",
                    )}
                  >
                    {r.ok ? (
                      <CircleCheckIcon className="size-3.5" aria-hidden />
                    ) : (
                      <CircleXIcon className="size-3.5" aria-hidden />
                    )}
                    {r.status ?? "none"}
                    <span className="sr-only">{r.ok ? "as expected" : "unexpected"}</span>
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
