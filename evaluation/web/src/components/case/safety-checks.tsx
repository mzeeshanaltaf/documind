import { CircleCheckIcon, CircleXIcon } from "lucide-react";
import { Fragment } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { MetricScoreOut, ProbeResult, RunCaseDetail } from "@/lib/api-types";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

const CONTEXT_CHARS = 90;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phrasePattern(phrase: string): string {
  return phrase.trim().split(/\s+/).map(escapeRegExp).join("\\s+");
}

/**
 * Excerpts of `text` around each occurrence of `phrases`, the phrase marked as flagged. Not the
 * highlighter: yellow means "this is the evidence" (DESIGN.md), and these spans are failures.
 */
function FlaggedExcerpts({ text, phrases }: { text: string; phrases: string[] }) {
  const unique = [...new Set(phrases.filter((p) => p.trim()))];
  if (!unique.length) return null;
  const regex = new RegExp(unique.map(phrasePattern).join("|"), "gi");
  const excerpts: { before: string; hit: string; after: string; at: number }[] = [];
  for (const match of text.matchAll(regex)) {
    const at = match.index ?? 0;
    const end = at + match[0].length;
    const start = Math.max(0, at - CONTEXT_CHARS);
    const stop = Math.min(text.length, end + CONTEXT_CHARS);
    excerpts.push({
      before: `${start > 0 ? "…" : ""}${text.slice(start, at)}`,
      hit: match[0],
      after: `${text.slice(end, stop)}${stop < text.length ? "…" : ""}`,
      at,
    });
    if (excerpts.length >= 4) break;
  }
  return (
    <ul className="flex flex-col gap-2">
      {excerpts.map((e) => (
        <li key={e.at} className="rounded-md bg-muted/60 px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap">
          {e.before}
          <mark className="rounded-[3px] bg-destructive/12 px-0.5 font-medium text-destructive underline decoration-destructive/60 underline-offset-2">
            {e.hit}
          </mark>
          {e.after}
        </li>
      ))}
    </ul>
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

function Verdict({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return ok ? (
    <span className="inline-flex items-center gap-1 font-medium text-success">
      <CircleCheckIcon className="size-3.5" aria-hidden />
      {yes}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 font-medium text-destructive">
      <CircleXIcon className="size-3.5" aria-hidden />
      {no}
    </span>
  );
}

/** An authz_probe case: each request, what it should get and what it got. */
export function ProbeRequests({ detail }: { detail: RunCaseDetail }) {
  const requests = ((detail.trace?.probes as ProbeResult[] | undefined) ?? []).length
    ? (detail.trace!.probes as ProbeResult[])
    : ((detail.scores.find((s) => s.metric === "authz_probe")?.details.requests as ProbeResult[] | undefined) ?? []);
  if (!requests.length) {
    return <p className="text-sm text-muted-foreground">No probe was sent{detail.error ? "" : " yet"}.</p>;
  }
  return (
    <div className="@container overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Request</TableHead>
            <TableHead className="hidden @xl:table-cell">Sent to</TableHead>
            <TableHead className="text-right">Expected</TableHead>
            <TableHead className="text-right">Got</TableHead>
            <TableHead className="hidden text-right @2xl:table-cell">Time</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {requests.map((r) => (
            <TableRow key={r.name}>
              <TableCell className="min-w-36 align-top whitespace-normal">
                <span className="text-sm">{r.name}</span>
                {r.eval_headers && (
                  <span className="mt-0.5 block text-xs text-muted-foreground">with eval headers</span>
                )}
              </TableCell>
              <TableCell className="hidden max-w-96 align-top font-mono text-xs break-all text-muted-foreground @xl:table-cell">
                {r.method} {r.url}
              </TableCell>
              <TableCell className="text-right align-top font-mono text-xs tabular-nums">{r.expect}</TableCell>
              <TableCell className="text-right align-top">
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
                {r.code && <span className="block font-mono text-xs text-muted-foreground">{r.code}</span>}
              </TableCell>
              <TableCell className="hidden text-right align-top text-xs text-muted-foreground tabular-nums @2xl:table-cell">
                {formatDuration(r.ms)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

type Judge = { behavior?: string; followed_injected_instruction?: boolean } | string | null | undefined;

function score(scores: MetricScoreOut[], key: string): MetricScoreOut | undefined {
  return scores.find((s) => s.metric === key && s.status !== "na");
}

/** Whether the case has a safety check worth its own section. */
export function hasSafetyChecks(detail: RunCaseDetail): boolean {
  const leak = score(detail.scores, "leakage");
  return Boolean(
    score(detail.scores, "injection_resisted") || score(detail.scores, "jurisdiction_confusion")?.value || leak?.value,
  );
}

/** Injection, leakage and jurisdiction checks of one case, with the offending answer text marked. */
export function SafetyChecks({ detail }: { detail: RunCaseDetail }) {
  const answer = detail.answer ?? "";
  const injection = score(detail.scores, "injection_resisted");
  const leak = score(detail.scores, "leakage");
  const confusion = score(detail.scores, "jurisdiction_confusion");

  const canaryHits = (injection?.details.canary_hits as string[] | undefined) ?? [];
  const fingerprintHits = (injection?.details.fingerprint_hits as string[] | undefined) ?? [];
  const judge = injection?.details.judge as Judge;
  const leakReasons = (leak?.details.reasons as Record<string, string>[] | undefined) ?? [];
  const leakedInAnswer = leakReasons
    .map((r) => (r.where === "answer" ? r.phrase : r.kind === "forbidden_code_in_answer" ? r.doc_code : null))
    .filter((p): p is string => !!p);
  const flagged = [...canaryHits, ...fingerprintHits, ...leakedInAnswer];
  const echoed = (leak?.details.echoed as string[] | undefined) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <dl className="flex flex-col">
        {injection && (
          <>
            <Pair label="Injection">
              <Verdict ok={injection.value === 1} yes="Resisted" no="Not resisted" />
            </Pair>
            <Pair label="Canary">
              {detail.case.injection_canary ? (
                <span className="font-mono text-xs">
                  {detail.case.injection_canary}
                  <span className="ml-2 font-sans text-muted-foreground">
                    {canaryHits.length ? "found in the answer" : "not in the answer"}
                  </span>
                </span>
              ) : (
                <span className="text-muted-foreground">none set</span>
              )}
            </Pair>
            <Pair label="System-prompt text">
              {fingerprintHits.length ? (
                <ul className="flex list-disc flex-col gap-0.5 pl-5">
                  {fingerprintHits.map((p) => (
                    <li key={p}>&ldquo;{p}&rdquo;</li>
                  ))}
                </ul>
              ) : (
                <span className="text-muted-foreground">none of the fingerprints appear</span>
              )}
            </Pair>
            <Pair label="Behaviour judge">
              {judge && typeof judge === "object" ? (
                <span>
                  <span className="font-mono text-xs">{judge.behavior}</span>
                  <span className="ml-2 text-muted-foreground">
                    {judge.followed_injected_instruction
                      ? "followed the injected instruction"
                      : "ignored the injected instruction"}
                  </span>
                </span>
              ) : (
                <span className="text-muted-foreground">
                  {judge === "unavailable" ? "failed; deterministic checks only" : "not run"}
                </span>
              )}
            </Pair>
          </>
        )}
        {leak && (leak.value === 1 || echoed.length > 0) && (
          <Pair label="Leakage">
            {leak.value === 1 ? (
              <ul className="flex flex-col gap-0.5 text-destructive">
                {leakReasons.map((r, i) => (
                  <li key={i}>
                    {r.kind === "canary"
                      ? `Canary phrase "${r.phrase}" in the ${r.where}`
                      : r.kind === "foreign_document"
                        ? `A source from another organization${r.doc_code ? ` (${r.doc_code})` : ""}`
                        : `${r.doc_code}: ${humanizeKind(r.kind)}`}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-muted-foreground">
                None. The answer repeats the user&apos;s own words ({echoed.join(", ")}), which doesn&apos;t count.
              </span>
            )}
          </Pair>
        )}
        {confusion?.value === 1 && (
          <Pair label="Jurisdiction">
            <span className="text-warning">
              Asked about <span className="font-mono text-xs">{String(confusion.details.expected)}</span>; cites{" "}
              {(
                (confusion.details.citations as {
                  n: number;
                  doc_code: string;
                  jurisdiction: string;
                }[]) ?? []
              ).map((c, i) => (
                <Fragment key={c.doc_code}>
                  {i > 0 && ", "}
                  <span className="font-mono text-xs">
                    [{c.n}] {c.doc_code} ({c.jurisdiction})
                  </span>
                </Fragment>
              ))}{" "}
              without naming that country.
            </span>
          </Pair>
        )}
      </dl>
      {flagged.length > 0 && answer && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-muted-foreground">Where it appears in the answer</h3>
          <FlaggedExcerpts text={answer} phrases={flagged} />
        </div>
      )}
    </div>
  );
}

function humanizeKind(kind: string): string {
  return (
    {
      forbidden_source: "retrieved",
      forbidden_citation: "cited",
      forbidden_code_in_answer: "named in the answer",
    }[kind] ?? kind
  );
}
