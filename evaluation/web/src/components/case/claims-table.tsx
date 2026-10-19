import { CircleCheckIcon, CircleHelpIcon, CircleXIcon } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ClaimOut } from "@/lib/api-types";
import { cn } from "@/lib/utils";

const VERDICTS = {
  supported: { label: "Supported", icon: CircleCheckIcon, className: "text-success" },
  contradicted: { label: "Contradicted", icon: CircleXIcon, className: "text-destructive" },
  not_found: { label: "Not found", icon: CircleHelpIcon, className: "text-warning" },
} as const;

function Ns({ ns }: { ns: number[] }) {
  if (!ns.length) return <span className="text-muted-foreground">none</span>;
  return <span className="font-mono text-xs">{ns.map((n) => `[${n}]`).join(" ")}</span>;
}

/** Every factual claim in the answer, what it cited, and what the judge found in the sources. */
export function ClaimsTable({ claims }: { claims: ClaimOut[] }) {
  if (!claims.length) return <p className="text-sm text-muted-foreground">No claims were extracted (the judge was off, or the answer made none).</p>;
  return (
    <div className="@container overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">#</TableHead>
            <TableHead>Claim and evidence</TableHead>
            <TableHead className="hidden @2xl:table-cell">Cited</TableHead>
            <TableHead className="hidden @2xl:table-cell">Supported by</TableHead>
            <TableHead className="text-right">Verdict</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {claims.map((claim) => {
            const verdict = claim.verdict ? VERDICTS[claim.verdict] : null;
            const Icon = verdict?.icon ?? CircleHelpIcon;
            return (
              <TableRow key={claim.idx} className="align-top">
                <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">{claim.idx}</TableCell>
                <TableCell className="max-w-0 min-w-64 whitespace-normal @2xl:max-w-none">
                  <p className="text-sm">{claim.text}</p>
                  {claim.evidence_quote && (
                    <p className="mt-1.5 font-heading text-[0.8125rem] leading-relaxed text-muted-foreground">
                      <mark className="rounded-[3px] bg-highlight px-0.5 text-highlight-foreground">{claim.evidence_quote}</mark>
                    </p>
                  )}
                  {claim.reasoning && <p className="mt-1.5 text-xs text-muted-foreground">{claim.reasoning}</p>}
                  <p className="mt-1.5 flex gap-3 text-xs text-muted-foreground @2xl:hidden">
                    <span>
                      Cited <Ns ns={claim.citation_ns} />
                    </span>
                    <span>
                      Supported by <Ns ns={claim.supporting_ns} />
                    </span>
                  </p>
                </TableCell>
                <TableCell className="hidden @2xl:table-cell">
                  <Ns ns={claim.citation_ns} />
                </TableCell>
                <TableCell className="hidden @2xl:table-cell">
                  <Ns ns={claim.supporting_ns} />
                </TableCell>
                <TableCell className="text-right">
                  <span className={cn("inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap", verdict?.className ?? "text-muted-foreground")}>
                    <Icon className="size-3.5" aria-hidden />
                    {verdict?.label ?? "Not checked"}
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
