import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageContainer } from "@/components/app/page-container";
import { PageSkeleton } from "@/components/app/shell-skeleton";
import { ButtonLink } from "@/components/button-link";
import { CaseAnswer, type CitedSource } from "@/components/case/answer";
import { ClaimsTable } from "@/components/case/claims-table";
import { ContextsTable } from "@/components/case/contexts-table";
import { JudgeReasoning, ScoresTable } from "@/components/case/scores";
import { DocuMindUsageTable, JudgeCallsTable } from "@/components/case/usage-tables";
import { runTitle } from "@/components/runs/runs-table";
import { CaseStatusBadge, PassMark } from "@/components/runs/status";
import { Badge } from "@/components/ui/badge";
import type { MetricInfo, RunCaseDetail, RunCaseOut, RunDetail } from "@/lib/api-types";
import { requireAdmin } from "@/lib/auth-guards";
import { apiJson, apiJsonOrNull } from "@/lib/eval-api";
import { formatDuration, formatUnitCost, humanize } from "@/lib/format";
import { indexMetrics } from "@/lib/metrics";

export const metadata: Metadata = { title: "Case" };

export default function CasePage({ params }: PageProps<"/runs/[id]/cases/[caseId]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Case params={params} />
    </Suspense>
  );
}

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <header className="flex flex-col gap-0.5">
        <h2 id={id} className="font-sans text-sm font-semibold">
          {title}
        </h2>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </header>
      {children}
    </section>
  );
}

function Pair({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b py-2 sm:flex-row sm:gap-4">
      <dt className="w-44 shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

function Codes({ values, empty = "none" }: { values: string[] | null | undefined; empty?: string }) {
  if (!values?.length) return <span className="text-muted-foreground">{empty}</span>;
  return <span className="font-mono text-xs">{values.join(", ")}</span>;
}

async function Case({ params }: { params: PageProps<"/runs/[id]/cases/[caseId]">["params"] }) {
  const { user } = await requireAdmin();
  const { id, caseId } = await params;
  const detail = await apiJsonOrNull<RunCaseDetail>(`runs/${id}/cases/${caseId}`, { userId: user.id });
  if (!detail) notFound();
  const [run, { cases }, registry] = await Promise.all([
    apiJson<RunDetail>(`runs/${id}`, { userId: user.id }),
    apiJson<{ cases: RunCaseOut[] }>(`runs/${id}/cases`, { userId: user.id }),
    apiJson<MetricInfo[]>("metrics", { userId: user.id }),
  ]);
  const index = indexMetrics(registry);

  const ordered = cases.toSorted((a, b) => a.case_key.localeCompare(b.case_key, "en", { numeric: true }));
  const position = ordered.findIndex((c) => c.id === detail.id);
  const prev = ordered[position - 1];
  const next = ordered[position + 1];

  const spec = detail.case;
  const routing = detail.routing;
  // Evidence quotes per source number: highlighted in the chips and the context rows.
  const quotesByN: Record<number, string[]> = {};
  for (const claim of detail.claims) {
    if (!claim.evidence_quote) continue;
    for (const n of claim.supporting_ns) (quotesByN[n] ??= []).push(claim.evidence_quote);
  }
  const answerContexts = run.mode === "full" ? detail.contexts : [];
  const sources: Record<number, CitedSource> = {};
  for (const c of answerContexts) {
    const citation = detail.citations?.find((x) => x.n === c.n);
    sources[c.n] ??= { ...c, title: citation?.title ?? null, quotes: quotesByN[c.n] ?? [] };
  }

  return (
    <PageContainer className="max-w-6xl gap-10">
      <div className="flex flex-col gap-4">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          <Link href="/runs" className="hover:text-foreground hover:underline">
            Runs
          </Link>
          <span aria-hidden>/</span>
          <Link href={`/runs/${id}`} className="hover:text-foreground hover:underline">
            {runTitle(run)}
          </Link>
          <span aria-hidden>/</span>
          <span className="font-mono text-foreground">{detail.case_key}</span>
        </nav>

        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-sm font-medium">{detail.case_key}</span>
              <Badge variant="secondary">{humanize(spec.type)}</Badge>
              <CaseStatusBadge status={detail.status} />
              <PassMark passed={detail.status === "done" ? detail.passed : null} />
              {detail.attempt > 1 && <span className="text-xs text-muted-foreground">attempt {detail.attempt}</span>}
            </div>
            <div className="flex items-center gap-1">
              <ButtonLink
                href={prev ? `/runs/${id}/cases/${prev.id}` : "#"}
                variant="ghost"
                size="sm"
                aria-disabled={!prev}
                className={prev ? undefined : "pointer-events-none opacity-50"}
              >
                <ChevronLeftIcon data-icon="inline-start" />
                {prev ? <span className="font-mono text-xs">{prev.case_key}</span> : "Previous"}
              </ButtonLink>
              <ButtonLink
                href={next ? `/runs/${id}/cases/${next.id}` : "#"}
                variant="ghost"
                size="sm"
                aria-disabled={!next}
                className={next ? undefined : "pointer-events-none opacity-50"}
              >
                {next ? <span className="font-mono text-xs">{next.case_key}</span> : "Next"}
                <ChevronRightIcon data-icon="inline-end" />
              </ButtonLink>
            </div>
          </div>
          <h1 className="max-w-[60ch] font-heading text-2xl leading-snug font-semibold tracking-[-0.01em]">{spec.question}</h1>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground tabular-nums">
            <span>Latency {formatDuration(detail.latency_ms)}</span>
            <span>First token {formatDuration(detail.ttft_ms)}</span>
            <span>DocuMind {formatUnitCost(detail.documind_cost_usd)}</span>
            <span>Judge {formatUnitCost(detail.judge_cost_usd)}</span>
          </p>
          {detail.error && (
            <p className="text-sm text-destructive">
              {detail.error_stage && <span className="font-mono">{detail.error_stage}: </span>}
              {detail.error}
            </p>
          )}
        </header>
      </div>

      <Section id="setup" title="The case" description="What the dataset asks and expects.">
        <dl className="flex flex-col">
          {spec.setup_turns.length > 0 && (
            <Pair label="Setup turns">
              <ol className="flex list-decimal flex-col gap-1 pl-5">
                {spec.setup_turns.map((turn, i) => (
                  <li key={i}>{turn}</li>
                ))}
              </ol>
            </Pair>
          )}
          <Pair label="Expected behaviour">{humanize(spec.expected_behavior)}</Pair>
          <Pair label="Expected documents">
            <Codes values={spec.expected_doc_codes} />
          </Pair>
          <Pair label="Expected sections">
            <Codes values={spec.expected_sections} />
          </Pair>
          {spec.reference_answer && (
            <Pair label="Reference answer">
              <span className="max-w-[72ch]">{spec.reference_answer}</span>
            </Pair>
          )}
          {spec.key_facts.length > 0 && (
            <Pair label="Key facts">
              <ul className="flex list-disc flex-col gap-1 pl-5">
                {spec.key_facts.map((fact, i) => (
                  <li key={i}>
                    {fact.fact}
                    {fact.weight !== 1 && <span className="ml-1.5 font-mono text-xs text-muted-foreground">×{fact.weight}</span>}
                  </li>
                ))}
              </ul>
            </Pair>
          )}
          {spec.tags.length > 0 && (
            <Pair label="Tags">
              <Codes values={spec.tags} />
            </Pair>
          )}
        </dl>
      </Section>

      <Section id="routing" title="Routing" description="How DocuMind's router read the question, next to what the case expects.">
        {routing ? (
          <dl className="flex flex-col">
            <Pair label="Departments">
              <Codes values={routing.departments} empty="none routed" />
              <span className="ml-2 text-xs text-muted-foreground">
                expected <Codes values={spec.expected_departments} empty="none" />
              </span>
            </Pair>
            <Pair label="Jurisdiction">
              <span className="font-mono text-xs">{routing.jurisdiction ?? "none"}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                expected <span className="font-mono">{spec.expected_jurisdiction ?? "none"}</span>
              </span>
            </Pair>
            <Pair label="Standalone query">
              {routing.standalone_query || <span className="text-muted-foreground">none</span>}
              {spec.expected_standalone_query && (
                <span className="mt-1 block text-xs text-muted-foreground">expected: {spec.expected_standalone_query}</span>
              )}
            </Pair>
            {(routing.parts?.length ?? 0) > 0 && (
              <Pair label="Parts">
                <ol className="flex list-decimal flex-col gap-1 pl-5">
                  {routing.parts!.map((part, i) => (
                    <li key={i}>
                      {part.query}{" "}
                      <span className="font-mono text-xs text-muted-foreground">
                        {[...(part.departments ?? []), part.jurisdiction].filter(Boolean).join(" · ")}
                      </span>
                    </li>
                  ))}
                </ol>
              </Pair>
            )}
            {routing.needs_clarification && (
              <Pair label="Clarification">{routing.clarifying_question ?? "Asked for clarification"}</Pair>
            )}
            {routing.bypassed && <Pair label="Bypassed">Scoped to documents, so routing was skipped.</Pair>}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">No routing was recorded.</p>
        )}
      </Section>

      {run.mode === "full" && (
        <Section id="answer" title="Answer" description="Hover a citation for the passage it points to; judged evidence is highlighted.">
          {detail.answer ? (
            <CaseAnswer answer={detail.answer} sources={sources} />
          ) : (
            <p className="text-sm text-muted-foreground">No answer was stored.</p>
          )}
        </Section>
      )}

      {run.mode === "full" && (
        <Section id="claims" title="Claims" description="Each claim in the answer, checked against the sources DocuMind gave it.">
          <ClaimsTable claims={detail.claims} />
        </Section>
      )}

      <Section
        id="contexts"
        title="Retrieved contexts"
        description="Label = the dataset's expected sections; Judge = the judge's relevance verdict; Cited = used in the answer."
      >
        <ContextsTable contexts={detail.contexts} quotesByN={quotesByN} />
      </Section>

      {run.mode === "full" && (
        <Section id="reasoning" title="Judge reasoning">
          <JudgeReasoning scores={detail.scores} index={index} />
        </Section>
      )}

      <Section id="scores" title="All scores">
        <ScoresTable scores={detail.scores} index={index} />
      </Section>

      {run.mode === "full" && (
        <Section id="judge-calls" title="Judge calls">
          <JudgeCallsTable calls={detail.judge_calls} />
        </Section>
      )}

      <Section id="usage" title="DocuMind usage" description="DocuMind's own metering for this case's requests.">
        <DocuMindUsageTable usage={detail.documind_usage} />
      </Section>
    </PageContainer>
  );
}
