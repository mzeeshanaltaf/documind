"use client";

import { ChevronsUpDownIcon, FilesIcon, LibraryIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { CatalogDoc } from "./types";

type Props = {
  documents: CatalogDoc[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
};

function groupByDepartment(documents: CatalogDoc[]) {
  const groups = new Map<string, CatalogDoc[]>();
  for (const doc of documents) {
    const key = doc.department ?? "Other";
    groups.set(key, [...(groups.get(key) ?? []), doc]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/** "All documents", or a multi-select of searchable documents grouped by department. */
export function ScopePicker({ documents, selected, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => groupByDepartment(documents), [documents]);
  const selectedSet = new Set(selected);

  function toggle(id: string) {
    onChange(selectedSet.has(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled || documents.length === 0}
            className="text-muted-foreground data-popup-open:bg-muted data-popup-open:text-foreground"
          />
        }
      >
        {selected.length ? <FilesIcon data-icon="inline-start" /> : <LibraryIcon data-icon="inline-start" />}
        {selected.length ? `${selected.length} document${selected.length === 1 ? "" : "s"}` : "All documents"}
        <ChevronsUpDownIcon data-icon="inline-end" />
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-[min(26rem,calc(100vw-2rem))] p-0">
        <Command>
          <CommandInput placeholder="Find a document by title or code…" />
          <CommandList className="max-h-80">
            <CommandEmpty>No document matches.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__all__ all documents"
                data-checked={selected.length === 0}
                onSelect={() => {
                  onChange([]);
                  setOpen(false);
                }}
              >
                <LibraryIcon className="text-muted-foreground" />
                <span className="flex flex-col">
                  <span>All documents</span>
                  <span className="text-xs text-muted-foreground">Route each question to the right department</span>
                </span>
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            {groups.map(([department, docs]) => (
              <CommandGroup key={department} heading={department}>
                {docs.map((doc) => (
                  <CommandItem
                    key={doc.id}
                    value={`${doc.id} ${doc.doc_code ?? ""} ${doc.title}`}
                    keywords={[doc.title, doc.doc_code ?? "", doc.jurisdiction ?? ""]}
                    data-checked={selectedSet.has(doc.id)}
                    onSelect={() => toggle(doc.id)}
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{doc.title}</span>
                      {doc.doc_code && <span className="font-mono text-[0.7rem] text-muted-foreground">{doc.doc_code}</span>}
                    </span>
                    {doc.jurisdiction && (
                      <Badge variant="outline" className="shrink-0 font-mono text-[0.65rem]">
                        {doc.jurisdiction}
                      </Badge>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** The current scope as removable chips above the composer. */
export function ScopeChips({
  documents,
  selected,
  onChange,
  disabled,
}: Props) {
  if (selected.length === 0) return null;
  const byId = new Map(documents.map((d) => [d.id, d]));
  return (
    <ul aria-label="Answering only from" className="flex flex-wrap gap-1.5 px-3 pt-2.5">
      {selected.map((id) => {
        const doc = byId.get(id);
        const label = doc?.doc_code ?? doc?.title ?? "Unavailable document";
        return (
          <li key={id}>
            <Badge variant="secondary" className="gap-1 pr-0.5">
              <span className="max-w-48 truncate font-mono text-[0.7rem]" title={doc?.title}>
                {label}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                className="size-4 rounded-sm"
                aria-label={`Remove ${doc?.title ?? label} from the scope`}
                disabled={disabled}
                onClick={() => onChange(selected.filter((s) => s !== id))}
              >
                <XIcon />
              </Button>
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}
