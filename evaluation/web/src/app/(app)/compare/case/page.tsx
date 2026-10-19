import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageContainer } from "@/components/app/page-container";
import { PageSkeleton } from "@/components/app/shell-skeleton";
import { CaseAnswer } from "@/components/case/answer";
import { ContextsTable } from "@/components/case/contexts-table";
import { JudgeReasoning } from "@/components/case/scores";
import { runTitle } from "@/components/runs/runs-table";
import { CaseStatusBadge, PassMark } from "@/components/runs/status";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { MetricInfo, MetricScoreOut, RunCaseDetail, RunCaseOut, RunDetail } from "@/lib/api-types";
import { requireAdmin } from "@/lib/auth-guards";
import { caseSources } from "@/lib/case-sources";
import { classifyChange, formatDelta } from "@/lib/compare";
import { apiJson, apiJsonOrNull } from "@/lib/eval-api";
import { formatDuration, formatUnitCost, humanize } from "@/lib/format";
import { formatMetric, GROUP_LABELS, groupMetrics, type MetricIndex, indexMetrics, metricLabel } from "@/lib/metrics";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Case side by side" };

export default function CompareCasePage({ searchParams }: PageProps<"/compare/case">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CompareCase searchParams={searchParams} />
    </Suspense>
  );
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

type Side = { label: "A" | "B"; run: RunDetail; detail: RunCaseDetail | null };

async function sideOf(label: "A" | "B", runId: string, key: string, userId: string): Promise<Side | null> {
  const [run, list] = await Promise.all([
    apiJsonOrNull<RunDetail>(`runs/${runId}`, { userId }),
    apiJsonOrNull<{ cases: RunCaseOut[] }>(`runs/${runId}/cases`, { userId }),
  ]);
  if (!run || !list) return null;
  const summary = list.cases.find((c) => c.case_key === key);
  const detail = summary ? await apiJsonOrNull<RunCaseDetail>(`runs/${runId}/cases/${summary.id}`, { userId }) : null;
  return { label, run, detail };
}

function scoringMode(run: RunDetail, requested: string | undefined): string {
  if (run.mode === "full") return "chat";
  const modes = run.config.retrieval_modes ?? ["hybrid"];
  return requested && modes.includes(requested as never) ? requested : modes.includes("hybrid") ? "hybrid" : modes[0];
}

function Row({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-col gap-0.5">
        <h2 className="font-sans text-sm font-semibold">{title}</h2>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </header>
      <div className="grid gap-6 lg:grid-cols-2">{children}</div>
    </section>
  );
}

function Column({ side, children }: { side: Side; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="font-mono text-xs font-semibold text-muted-foreground">{side.label}</span>
      {children}
    </div>
  );
}

async function CompareCase({ searchParams }: { searchParams: PageProps<"/compare/case">["searchParams"] }) {
  const { user } = await requireAdmin();
  const params = await searchParams;
  const a = one(params.a);
  const b = one(params.b);
  const key = one(params.key);
  if (!a || !b || !key) notFound();
  const [sideA, sideB, registry] = await Promise.all([
    sideOf("A", a, key, user.id),
    sideOf("B", b, key, user.id),
    apiJson<MetricInfo[]>("metrics", { userId: user.id }),
  ]);
  if (!sideA || !sideB || (!sideA.detail && !sideB.detail)) notFound();
  const index = indexMetrics(registry);
  const sides = [sideA, sideB];
  const spec = (sideA.detail ?? sideB.detail)!.case;
  const mode = scoringMode(sideA.run, one(params.mode));
  const full = sides.some((s) => s.run.mode === "full");
  const back = `/compare?a=${a}&b=${b}${one(params.mode) ? `&mode=${one(params.mode)}` : ""}`;

  return (
    <PageContainer className="max-w-7xl gap-10">
      <div className="flex flex-col gap-4">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          <Link href={back} className="hover:text-foreground hover:underline">
            Compare
          </Link>
          <span aria-hidden>/</span>
          <span className="font-mono text-foreground">{key}</span>
        </nav>
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-sm font-medium">{key}</span>
            <Badge variant="secondary">{humanize(spec.type)}</Badge>
            <span className="text-xs text-muted-foreground">expects {humanize(spec.expected_behavior).toLowerCase()}</span>
            {spec.expected_sections.length > 0 && (
              <span className="font-mono text-xs text-muted-foreground">{spec.expected_sections.join(", ")}</span>
            )}
          </div>
          <h1 className="max-w-[60ch] font-heading text-2xl leading-snug font-semibold tracking-[-0.01em]">{spec.question}</h1>
        </header>
        <div className="grid divide-y rounded-lg border lg:grid-cols-2 lg:divide-x lg:divide-y-0">
          {sides.map((side) => (
            <SideHeader key={side.label} side={side} />
          ))}
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <header className="flex flex-col gap-0.5">
          <h2 className="font-sans text-sm font-semibold">Scores</h2>
          <p className="text-xs text-muted-foreground">
            Both runs&apos; scores in <span className="font-mono">{mode}</span>. Coloured deltas moved beyond the per-case band.
          </p>
        </header>
        <ScoreDiff a={sideA.detail?.scores ?? []} b={sideB.detail?.scores ?? []} mode={mode} index={index} />
      </section>

      {full && (
        <Row title="Answers" description="Hover a citation for its passage; judged evidence is highlighted.">
          {sides.map((side) => {
            const answer = side.detail?.answer;
            return (
              <Column key={side.label} side={side}>
                {answer ? (
                  <CaseAnswer answer={answer} sources={caseSources(side.detail!, side.run.mode).sources} />
                ) : (
                  <p className="text-sm text-muted-foreground">No answer was stored.</p>
                )}
              </Column>
            );
          })}
        </Row>
      )}

      {full && (
        <Row title="Judge verdicts">
          {sides.map((side) => (
            <Column key={side.label} side={side}>
              <JudgeReasoning scores={(side.detail?.scores ?? []).filter((s) => s.mode === "chat")} index={index} />
            </Column>
          ))}
        </Row>
      )}

      <Row title="Retrieved contexts" description="Label = the dataset's expected sections; Judge = relevance verdict; Cited = used in the answer.">
        {sides.map((side) => {
          const detail = side.detail;
          const contexts = (detail?.contexts ?? []).filter((c) => side.run.mode === "full" || c.mode === scoringMode(side.run, mode));
          return (
            <Column key={side.label} side={side}>
              <ContextsTable contexts={contexts} quotesByN={detail ? caseSources(detail, side.run.mode).quotesByN : {}} />
            </Column>
          );
        })}
      </Row>
    </PageContainer>
  );
}

function SideHeader({ side }: { side: Side }) {
  const { run, detail } = side;
  return (
    <div className="flex min-w-0 flex-col gap-1.5 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-semibold text-muted-foreground">{side.label}</span>
        <Link href={`/runs/${run.id}`} className="truncate font-medium hover:underline">
          {runTitle(run)}
        </Link>
        {detail ? (
          detail.status === "done" ? (
            <PassMark passed={detail.passed} />
          ) : (
            <CaseStatusBadge status={detail.status} />
          )
        ) : (
          <span className="text-xs text-muted-foreground">not in this run</span>
        )}
      </div>
      {detail && (
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
          <span>Latency {formatDuration(detail.latency_ms)}</span>
          <span>DocuMind {formatUnitCost(detail.documind_cost_usd)}</span>
          <span>Judge {formatUnitCost(detail.judge_cost_usd)}</span>
          <Link href={`/runs/${run.id}/cases/${detail.id}`} className="hover:text-foreground hover:underline">
            Full drill-down
          </Link>
        </p>
      )}
      {detail?.error && <p className="text-xs text-destructive">{detail.error}</p>}
    </div>
  );
}

function ScoreValue({ score, info }: { score: MetricScoreOut | undefined; info: MetricInfo | undefined }) {
  if (!score) return <span className="text-muted-foreground">n/a</span>;
  if (score.status !== "ok")
    return <span className={score.status === "na" ? "text-muted-foreground" : "text-destructive"}>{score.status}</span>;
  return <>{formatMetric(score.value, info, { single: true })}</>;
}

function ScoreDiff({ a, b, mode, index }: { a: MetricScoreOut[]; b: MetricScoreOut[]; mode: string; index: MetricIndex }) {
  const byA = new Map(a.filter((s) => s.mode === mode).map((s) => [s.metric, s]));
  const byB = new Map(b.filter((s) => s.mode === mode).map((s) => [s.metric, s]));
  const groups = groupMetrics([...new Set([...byA.keys(), ...byB.keys()])], index);
  if (!groups.length) return <p className="text-sm text-muted-foreground">No scores in this mode.</p>;
  return (
    <div className="@container overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Metric</TableHead>
            <TableHead className="text-right">A</TableHead>
            <TableHead className="text-right">B</TableHead>
            <TableHead className="text-right">Δ</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.flatMap(({ group, keys }) => [
            <TableRow key={`g-${group}`} className="hover:bg-transparent">
              <TableCell colSpan={4} className="bg-muted/50 py-1.5 text-xs font-semibold text-muted-foreground">
                {GROUP_LABELS[group] ?? group}
              </TableCell>
            </TableRow>,
            ...keys.map((key) => {
              const sa = byA.get(key);
              const sb = byB.get(key);
              const va = sa?.status === "ok" ? sa.value : null;
              const vb = sb?.status === "ok" ? sb.value : null;
              const info = index[key];
              const change = group === "operational" ? null : classifyChange(va, vb, info);
              return (
                <TableRow key={key}>
                  <TableCell title={info?.description}>{metricLabel(key)}</TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    <ScoreValue score={sa} info={info} />
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    <ScoreValue score={sb} info={info} />
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono text-xs tabular-nums",
                      change === "regressed" && "font-medium text-destructive",
                      change === "improved" && "font-medium text-success",
                      (change === "unchanged" || change === null) && "text-muted-foreground",
                    )}
                  >
                    {va === null || vb === null ? "" : formatDelta(vb - va, info)}
                  </TableCell>
                </TableRow>
              );
            }),
          ])}
        </TableBody>
      </Table>
    </div>
  );
}
