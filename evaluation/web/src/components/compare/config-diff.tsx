import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Comparison } from "@/lib/api-types";
import { configKeyParts, formatConfigValue } from "@/lib/compare";

/**
 * Everything that differs between the two runs' setups, grouped by where it lives: the run
 * config, DocuMind (version, prompt hashes, retrieval constants), the org's settings and
 * documents, judge prompt versions, the dataset and the eval harness itself.
 */
export function ConfigDiff({ diff, hash }: { diff: Comparison["config_diff"]; hash: string }) {
  if (!diff.length) {
    return (
      <p className="text-sm text-muted-foreground">
        Same setup: config (<span className="font-mono">{hash.slice(0, 8)}</span>), DocuMind version and prompts, judge
        prompts and dataset version all match. Any difference below is chance.
      </p>
    );
  }
  const rows = diff.map((d) => ({ ...d, parts: configKeyParts(d.key) }));
  return (
    <div className="@container overflow-hidden rounded-lg border">
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[40%]">Setting</TableHead>
            <TableHead>A</TableHead>
            <TableHead>B</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((d, i) => (
            <TableRow key={d.key}>
              <TableCell className="align-top">
                <span className="flex flex-col gap-0.5">
                  {rows[i - 1]?.parts[0] !== d.parts[0] && (
                    <span className="text-[0.7rem] font-medium text-muted-foreground">{d.parts[0]}</span>
                  )}
                  <span className="font-mono text-xs wrap-break-word whitespace-normal">{d.parts[1]}</span>
                </span>
              </TableCell>
              <TableCell className="align-top font-mono text-xs wrap-break-word whitespace-normal text-muted-foreground">
                {formatConfigValue(d.a)}
              </TableCell>
              <TableCell className="align-top font-mono text-xs wrap-break-word whitespace-normal">{formatConfigValue(d.b)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
