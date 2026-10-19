"use client";

import { PlusIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { OptionSelect } from "@/components/app/option-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CaseOut } from "@/lib/api-types";
import { humanize } from "@/lib/format";
import { CaseForm } from "./case-form";

const ALL = "__all";

/** The case sheet of one version: filterable list, and a side sheet per case (an editor for drafts). */
export function VersionCases({
  versionId,
  cases,
  editable,
  initialCaseId,
}: {
  versionId: string;
  cases: CaseOut[];
  editable: boolean;
  initialCaseId?: string;
}) {
  const [open, setOpen] = useState<string | "new" | null>(
    initialCaseId && cases.some((c) => c.id === initialCaseId) ? initialCaseId : null,
  );
  const [type, setType] = useState(ALL);
  const [tag, setTag] = useState(ALL);
  const [query, setQuery] = useState("");

  const types = useMemo(() => [...new Set(cases.map((c) => c.type))].sort(), [cases]);
  const tags = useMemo(() => [...new Set(cases.flatMap((c) => c.tags))].sort(), [cases]);
  const q = query.trim().toLowerCase();
  const rows = cases.filter(
    (c) =>
      (type === ALL || c.type === type) &&
      (tag === ALL || c.tags.includes(tag)) &&
      (!q || c.case_key.toLowerCase().includes(q) || c.question.toLowerCase().includes(q)),
  );
  const current = open && open !== "new" ? (cases.find((c) => c.id === open) ?? null) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Case filters">
        <InputGroup className="w-56">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput aria-label="Search cases" placeholder="Search key or question" value={query} onChange={(e) => setQuery(e.target.value)} />
        </InputGroup>
        <OptionSelect
          size="sm"
          aria-label="Type"
          value={type}
          onValueChange={setType}
          options={[{ value: ALL, label: "Any type" }, ...types.map((t) => ({ value: t, label: humanize(t) }))]}
        />
        {tags.length > 0 && (
          <OptionSelect
            size="sm"
            aria-label="Tag"
            value={tag}
            onValueChange={setTag}
            options={[{ value: ALL, label: "Any tag" }, ...tags.map((t) => ({ value: t, label: t }))]}
          />
        )}
        <span className="text-sm text-muted-foreground tabular-nums">
          {rows.length === cases.length ? `${cases.length} cases` : `${rows.length} of ${cases.length} cases`}
        </span>
        {editable && (
          <Button size="sm" className="ml-auto" onClick={() => setOpen("new")}>
            <PlusIcon data-icon="inline-start" />
            Add case
          </Button>
        )}
      </div>

      <div className="@container overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Case</TableHead>
              <TableHead className="hidden @2xl:table-cell">Expects</TableHead>
              <TableHead className="hidden @3xl:table-cell">Documents</TableHead>
              <TableHead className="hidden @4xl:table-cell">Tags</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                  {cases.length === 0 ? "This version has no cases yet." : "No cases match these filters."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="max-w-0 min-w-56 @2xl:max-w-lg">
                    <button
                      type="button"
                      onClick={() => setOpen(c.id)}
                      className="flex w-full min-w-0 flex-col gap-0.5 rounded-sm text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-xs font-medium hover:underline">{c.case_key}</span>
                        <span className="text-xs text-muted-foreground">{humanize(c.type)}</span>
                        {c.reference_answer && <span className="text-xs text-muted-foreground">· reference</span>}
                      </span>
                      <span className="truncate text-sm text-muted-foreground">{c.question}</span>
                    </button>
                  </TableCell>
                  <TableCell className="hidden text-sm @2xl:table-cell">{humanize(c.expected_behavior)}</TableCell>
                  <TableCell className="hidden font-mono text-xs @3xl:table-cell">
                    {c.expected_sections.length ? c.expected_sections.join(", ") : c.expected_doc_codes.join(", ") || "none"}
                  </TableCell>
                  <TableCell className="hidden @4xl:table-cell">
                    <span className="flex flex-wrap gap-1">
                      {c.tags.map((t) => (
                        <Badge key={t} variant="secondary">
                          {t}
                        </Badge>
                      ))}
                    </span>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Sheet open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle className="font-heading">
              {open === "new" ? "New case" : <span className="font-mono text-base">{current?.case_key}</span>}
            </SheetTitle>
            <SheetDescription>
              {editable ? "Changes are saved to this draft." : "Published versions are read-only. Create a draft to change cases."}
            </SheetDescription>
          </SheetHeader>
          {open !== null && (
            <div className="px-4">
              <CaseForm
                key={open}
                versionId={versionId}
                value={current}
                readOnly={!editable}
                onSaved={(saved) => {
                  toast.success(open === "new" ? `Added ${saved.case_key}.` : `Saved ${saved.case_key}.`);
                  setOpen(null);
                }}
                onDeleted={() => {
                  toast.success("Case deleted.");
                  setOpen(null);
                }}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
