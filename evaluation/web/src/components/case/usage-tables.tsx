import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { JudgeCallOut } from "@/lib/api-types";
import { formatCompact, formatDuration, formatUnitCost } from "@/lib/format";

/** Every Anthropic call made for this case, with tokens (cache writes and reads) and cost. */
export function JudgeCallsTable({ calls }: { calls: JudgeCallOut[] }) {
  if (!calls.length) return <p className="text-sm text-muted-foreground">No judge calls for this case.</p>;
  const total = calls.reduce((s, c) => s + c.cost_usd, 0);
  return (
    <div className="@container overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Purpose</TableHead>
            <TableHead className="hidden @2xl:table-cell">Model</TableHead>
            <TableHead className="hidden text-right @3xl:table-cell">In / cache w / cache r / out</TableHead>
            <TableHead className="hidden text-right @xl:table-cell">Latency</TableHead>
            <TableHead className="text-right">Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {calls.map((c) => (
            <TableRow key={c.id}>
              <TableCell>
                <span className="font-mono text-xs">{c.purpose.replace(/^judge\./, "")}</span>
                {c.sample_idx > 0 && <span className="ml-1.5 text-xs text-muted-foreground">sample {c.sample_idx + 1}</span>}
                {c.status !== "ok" && (
                  <span className="ml-1.5 text-xs text-destructive" title={c.error ?? undefined}>
                    {c.status}
                  </span>
                )}
                {c.stop_reason && c.stop_reason !== "end_turn" && (
                  <span className="ml-1.5 text-xs text-warning">{c.stop_reason}</span>
                )}
              </TableCell>
              <TableCell className="hidden font-mono text-xs @2xl:table-cell">
                {c.model_actual ?? c.model}
                {c.effort && <span className="text-muted-foreground"> · {c.effort}</span>}
                {c.model_actual && c.model_actual !== c.model && <span className="block text-warning">fallback from {c.model}</span>}
              </TableCell>
              <TableCell className="hidden text-right font-mono text-xs text-muted-foreground tabular-nums @3xl:table-cell">
                {[c.input_tokens, c.cache_write_tokens, c.cache_read_tokens, c.output_tokens].map(formatCompact).join(" / ")}
              </TableCell>
              <TableCell className="hidden text-right text-xs text-muted-foreground tabular-nums @xl:table-cell">
                {formatDuration(c.latency_ms)}
              </TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums">{formatUnitCost(c.cost_usd)}</TableCell>
            </TableRow>
          ))}
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={4} className="text-right text-xs text-muted-foreground @max-xl:hidden">
              {calls.length} calls
            </TableCell>
            <TableCell className="text-right font-mono text-xs font-semibold tabular-nums">{formatUnitCost(total)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

type Operation = {
  turn?: number;
  operation?: string;
  model?: string | null;
  tier_actual?: string | null;
  input_tokens?: number;
  cached_tokens?: number;
  output_tokens?: number;
  latency_ms?: number | null;
  ttft_ms?: number | null;
  cost_usd?: number;
};

/** DocuMind's own metering for the case: one row per LLM call (router, embedding, answer, …). */
export function DocuMindUsageTable({ usage }: { usage: Record<string, unknown> | null }) {
  const operations = (usage?.by_operation as Operation[] | undefined) ?? [];
  if (!operations.length) return <p className="text-sm text-muted-foreground">No DocuMind usage was recorded for this case.</p>;
  const total = operations.reduce((s, o) => s + (o.cost_usd ?? 0), 0);
  const multiTurn = new Set(operations.map((o) => o.turn)).size > 1;
  return (
    <div className="@container overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Operation</TableHead>
            <TableHead className="hidden @2xl:table-cell">Model</TableHead>
            <TableHead className="hidden text-right @3xl:table-cell">In / cached / out</TableHead>
            <TableHead className="hidden text-right @xl:table-cell">Latency</TableHead>
            <TableHead className="text-right">Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {operations.map((o, i) => (
            <TableRow key={i}>
              <TableCell>
                <span className="font-mono text-xs">{o.operation ?? "n/a"}</span>
                {multiTurn && <span className="ml-1.5 text-xs text-muted-foreground">turn {(o.turn ?? 0) + 1}</span>}
              </TableCell>
              <TableCell className="hidden font-mono text-xs @2xl:table-cell">
                {o.model ?? "n/a"}
                {o.tier_actual && <span className="text-muted-foreground"> · {o.tier_actual}</span>}
              </TableCell>
              <TableCell className="hidden text-right font-mono text-xs text-muted-foreground tabular-nums @3xl:table-cell">
                {[o.input_tokens, o.cached_tokens, o.output_tokens].map((v) => formatCompact(v ?? 0)).join(" / ")}
              </TableCell>
              <TableCell className="hidden text-right text-xs text-muted-foreground tabular-nums @xl:table-cell">
                {formatDuration(o.latency_ms)}
                {o.ttft_ms ? <span className="block">first token {formatDuration(o.ttft_ms)}</span> : null}
              </TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums">{formatUnitCost(o.cost_usd)}</TableCell>
            </TableRow>
          ))}
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={4} className="text-right text-xs text-muted-foreground @max-xl:hidden">
              {operations.length} calls
            </TableCell>
            <TableCell className="text-right font-mono text-xs font-semibold tabular-nums">{formatUnitCost(total)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
