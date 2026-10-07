"use client";

import { EyeIcon } from "lucide-react";
import useSWR from "swr";
import { usePdfViewer } from "@/components/pdf/pdf-viewer-provider";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import type { DocumentDetail, DocumentRow } from "@/lib/api-types";
import { DOC_TYPE_LABELS, formatCount, formatDate, jurisdictionName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DocumentStatus } from "./document-status";

async function fetchDetail(url: string): Promise<DocumentDetail> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return (await response.json()) as DocumentDetail;
}

type Props = { orgId: string; doc: DocumentRow | null; onOpenChange: (open: boolean) => void };

export function DocumentDetailSheet({ orgId, doc, onOpenChange }: Props) {
  return (
    <Sheet open={!!doc} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 data-[side=right]:sm:max-w-lg">
        {doc && <DetailBody key={doc.id} orgId={orgId} doc={doc} />}
      </SheetContent>
    </Sheet>
  );
}

function DetailBody({ orgId, doc }: { orgId: string; doc: DocumentRow }) {
  const { openDocument } = usePdfViewer();
  const { data, error, isLoading } = useSWR(
    `/api/backend/orgs/${encodeURIComponent(orgId)}/documents/${encodeURIComponent(doc.id)}`,
    fetchDetail,
  );
  const detail = data ?? null;
  const view = (page = 1) => openDocument({ documentId: doc.id, title: doc.title, docCode: doc.doc_code, page });

  const facts: [string, React.ReactNode][] = [
    ["Department", doc.department ?? "Not set"],
    ["Jurisdiction", doc.jurisdiction ? `${jurisdictionName(doc.jurisdiction)} (${doc.jurisdiction})` : "Not set"],
    ["Type", DOC_TYPE_LABELS[doc.doc_type ?? ""] ?? "Not set"],
    ["Version", doc.version ?? "n/a"],
    ["Effective", formatDate(doc.effective_date)],
    ["Owner", doc.owner ?? "n/a"],
    ["Approved by", doc.approved_by ?? "n/a"],
    ["Review cycle", doc.review_cycle ?? "n/a"],
    ["Pages", doc.page_count ?? "n/a"],
    ["Passages indexed", formatCount(detail?.chunk_count ?? doc.chunk_count)],
  ];

  return (
    <>
      <SheetHeader className="gap-1 border-b px-5 pt-5 pr-12 pb-4">
        {doc.doc_code && <span className="font-mono text-[0.7rem] tracking-wide text-muted-foreground">{doc.doc_code}</span>}
        <SheetTitle className="text-lg leading-snug font-semibold">{doc.title}</SheetTitle>
        <SheetDescription className="sr-only">Summary, outline and metadata</SheetDescription>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <DocumentStatus doc={doc} />
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => view()} disabled={!doc.indexed_at && doc.status !== "ready"}>
            <EyeIcon data-icon="inline-start" />
            View PDF
          </Button>
        </div>
      </SheetHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <section aria-labelledby="doc-summary" className="flex flex-col gap-2">
          <h3 id="doc-summary" className="text-sm font-semibold">
            Summary
          </h3>
          {isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ) : (
            <p className="font-heading text-[0.9rem] leading-relaxed text-muted-foreground">
              {detail?.summary ?? (error ? "Couldn't load the summary." : "No summary yet. It's written during indexing.")}
            </p>
          )}
        </section>

        <Separator className="my-5" />

        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          {facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-words">{value}</dd>
            </div>
          ))}
        </dl>
        {doc.applies_to && (
          <p className="pt-3 text-sm">
            <span className="text-muted-foreground">Applies to: </span>
            {doc.applies_to}
          </p>
        )}

        <Separator className="my-5" />

        <section aria-labelledby="doc-outline" className="flex flex-col gap-2">
          <h3 id="doc-outline" className="text-sm font-semibold">
            Outline
          </h3>
          {isLoading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-5 w-full" />
              ))}
            </div>
          ) : detail?.outline?.length ? (
            <ol className="flex flex-col">
              {detail.outline.map((item, index) => (
                <li key={`${item.page}-${index}`}>
                  <button
                    type="button"
                    onClick={() => view(item.page)}
                    className={cn(
                      "flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                      item.level > 1 && "pl-6 text-muted-foreground",
                    )}
                  >
                    {item.number && <span className="shrink-0 font-mono text-xs text-muted-foreground">{item.number}</span>}
                    <span className="min-w-0 flex-1">{item.title}</span>
                    <span className="shrink-0 font-mono text-[0.7rem] text-muted-foreground">p. {item.page}</span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">No outline was found in this PDF.</p>
          )}
        </section>
      </div>
    </>
  );
}
