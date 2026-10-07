"use client";

import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TimeseriesPoint } from "@/lib/api-types";
import { formatCompact, formatCost, formatCount, formatDate, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The charts' numbers as a table: the accessible (and exact) view of the same series. */
export function DailyTable({ points, granularity }: { points: TimeseriesPoint[]; granularity: "day" | "week" }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" />}>
        <ChevronRightIcon data-icon="inline-start" className={cn("transition-transform duration-200", open && "rotate-90")} />
        View the {granularity === "week" ? "weekly" : "daily"} figures as a table
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 max-h-96 overflow-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{granularity === "week" ? "Week of" : "Day"}</TableHead>
                <TableHead className="text-right">Answers</TableHead>
                <TableHead className="text-right">Input</TableHead>
                <TableHead className="text-right">Cached</TableHead>
                <TableHead className="text-right">Output</TableHead>
                <TableHead className="text-right">p95 latency</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...points].reverse().map((p) => (
                <TableRow key={p.date}>
                  <TableCell className="tabular-nums">{formatDate(p.date)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCount(p.requests)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCompact(p.input_tokens)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCompact(p.cached_tokens)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCompact(p.output_tokens)}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.p95_latency_ms === null ? "n/a" : formatDuration(p.p95_latency_ms)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCost(p.cost_usd)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
