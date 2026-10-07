"use client";

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  ExternalLinkIcon,
  MoveHorizontalIcon,
  RotateCcwIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { pageLabel } from "@/lib/format";
import { escapeHtml, normalizePassage, shouldHighlight } from "./highlight";
import { documentFileUrl, type ViewerRequest } from "./pdf-viewer-provider";

// Must be set in the module that renders <Document> (react-pdf v11).
pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
const PAGE_GUTTER = 32; // px of breathing room around the page at fit-width

type Props = {
  orgId: string;
  request: ViewerRequest & { nonce: number };
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function PdfViewerSheet({ orgId, request, open, onOpenChange }: Props) {
  const fileUrl = documentFileUrl(orgId, request.documentId);
  const citedStart = request.page ?? 1;
  const citedEnd = Math.max(request.pageEnd ?? citedStart, citedStart);

  const [numPages, setNumPages] = useState<number | null>(null);
  const [page, setPage] = useState(citedStart);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);
  const [loadKey, setLoadKey] = useState(0);

  // A new citation click (nonce) jumps to its page; a different document resets the page count.
  const [seen, setSeen] = useState({ nonce: request.nonce, documentId: request.documentId });
  if (seen.nonce !== request.nonce) {
    setSeen({ nonce: request.nonce, documentId: request.documentId });
    setPage(citedStart);
    if (seen.documentId !== request.documentId) setNumPages(null);
  }

  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const scrolledNonce = useRef(0);
  const renderedKey = useRef("");

  const passage = useMemo(
    () => (request.highlightText ? normalizePassage(request.highlightText) : null),
    [request.highlightText],
  );
  const contentKey = `${request.documentId}:${page}:${passage ?? ""}`;

  const renderText = useCallback(
    ({ str, pageNumber }: { str: string; pageNumber: number }) => {
      const safe = escapeHtml(str);
      if (!passage || pageNumber < citedStart || pageNumber > citedEnd) return safe;
      return shouldHighlight(str, passage) ? `<mark>${safe}</mark>` : safe;
    },
    [passage, citedStart, citedEnd],
  );

  const scrollToCitation = useCallback(() => {
    scrolledNonce.current = request.nonce;
    const mark = pageRef.current?.querySelector(".textLayer mark");
    if (mark) {
      mark.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    } else {
      scrollRef.current?.scrollTo({ top: 0 });
    }
  }, [request.nonce]);

  // Reopening the same passage: the text layer is already rendered, so no render callback fires.
  useEffect(() => {
    if (!open || scrolledNonce.current === request.nonce || renderedKey.current !== contentKey) return;
    const frame = requestAnimationFrame(scrollToCitation);
    return () => cancelAnimationFrame(frame);
  }, [open, request.nonce, contentKey, scrollToCitation]);

  const onTextLayerRendered = useCallback(() => {
    renderedKey.current = contentKey;
    if (scrolledNonce.current !== request.nonce && page === citedStart) scrollToCitation();
  }, [contentKey, request.nonce, page, citedStart, scrollToCitation]);

  // Width of the scroll area, observed through a zero-height sentinel that never grows with the page.
  const sentinelRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.floor(entry.contentRect.width);
      if (next > 0) setWidth(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  function goTo(target: number) {
    const last = numPages ?? target;
    const next = Math.min(Math.max(1, Math.round(target)), last);
    if (next !== page) {
      setPage(next);
      scrollRef.current?.scrollTo({ top: 0 });
    }
  }

  function zoomBy(direction: 1 | -1) {
    const index = ZOOM_STEPS.findIndex((step) => step >= zoom - 0.001);
    const nextIndex = Math.min(Math.max(0, (index === -1 ? ZOOM_STEPS.length - 1 : index) + direction), ZOOM_STEPS.length - 1);
    setZoom(ZOOM_STEPS[nextIndex]);
  }

  const pageWidth = width > 0 ? Math.max(200, Math.round((width - PAGE_GUTTER) * zoom)) : 0;
  const outsideCitation = !!request.highlightText && (page < citedStart || page > citedEnd);
  const downloadName = `${request.docCode || request.title}.pdf`.replace(/[\\/:*?"<>|]+/g, " ");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        keepMounted
        className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:w-[min(52rem,92vw)] data-[side=right]:sm:max-w-none"
      >
        <SheetHeader className="gap-1 border-b px-4 pt-4 pr-12 pb-3">
          {request.docCode && (
            <span className="font-mono text-[0.7rem] tracking-wide text-muted-foreground">{request.docCode}</span>
          )}
          <SheetTitle className="truncate text-base font-semibold">{request.title}</SheetTitle>
          <SheetDescription className="text-xs">
            {request.highlightText ? (
              <>
                Cited passage on {pageLabel(citedStart, citedEnd)}, marked in yellow.
                {outsideCitation && (
                  <Button variant="link" size="xs" className="ml-1 h-auto p-0 text-xs" onClick={() => goTo(citedStart)}>
                    Back to the cited page
                  </Button>
                )}
              </>
            ) : (
              "Original PDF"
            )}
          </SheetDescription>
        </SheetHeader>

        <div
          role="toolbar"
          aria-label="Document controls"
          className="flex flex-wrap items-center gap-x-1 gap-y-2 border-b px-3 py-2"
        >
          <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => goTo(page - 1)}>
            <ChevronLeftIcon />
          </Button>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Input
              key={page}
              aria-label="Page number"
              inputMode="numeric"
              defaultValue={page}
              className="h-7 w-12 px-1.5 text-center tabular-nums"
              onKeyDown={(e) => {
                if (e.key === "Enter") goTo(Number(e.currentTarget.value) || page);
              }}
              onBlur={(e) => goTo(Number(e.currentTarget.value) || page)}
            />
            <span className="tabular-nums">of {numPages ?? "…"}</span>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next page"
            disabled={numPages === null || page >= numPages}
            onClick={() => goTo(page + 1)}
          >
            <ChevronRightIcon />
          </Button>

          <Separator orientation="vertical" className="mx-1 h-5" />

          <Button variant="ghost" size="icon-sm" aria-label="Zoom out" disabled={zoom <= ZOOM_STEPS[0]} onClick={() => zoomBy(-1)}>
            <ZoomOutIcon />
          </Button>
          <span className="w-11 text-center text-sm text-muted-foreground tabular-nums" aria-live="polite">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom in"
            disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
            onClick={() => zoomBy(1)}
          >
            <ZoomInIcon />
          </Button>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon-sm" aria-label="Fit to width" disabled={zoom === 1} onClick={() => setZoom(1)} />
              }
            >
              <MoveHorizontalIcon />
            </TooltipTrigger>
            <TooltipContent>Fit to width</TooltipContent>
          </Tooltip>

          <div className="ml-auto flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger
                render={
                  <a
                    href={fileUrl}
                    download={downloadName}
                    aria-label="Download PDF"
                    className="inline-flex size-7 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none [&_svg]:size-4"
                  />
                }
              >
                <DownloadIcon />
              </TooltipTrigger>
              <TooltipContent>Download</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <a
                    href={fileUrl}
                    target="_blank"
                    rel="noopener"
                    aria-label="Open in new tab"
                    className="inline-flex size-7 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none [&_svg]:size-4"
                  />
                }
              >
                <ExternalLinkIcon />
              </TooltipTrigger>
              <TooltipContent>Open in new tab</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col bg-muted">
          <div ref={sentinelRef} className="h-0 w-full" aria-hidden />
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
            <Document
              key={`${request.documentId}:${loadKey}`}
              file={fileUrl}
              suspense={false}
              onLoadSuccess={(pdf) => {
                setNumPages(pdf.numPages);
                if (page > pdf.numPages) setPage(pdf.numPages);
              }}
              loading={<PageSkeleton />}
              error={
                <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                  <p className="text-sm text-muted-foreground">This PDF couldn&apos;t be loaded. Check your connection and try again.</p>
                  <Button variant="outline" size="sm" onClick={() => setLoadKey((k) => k + 1)}>
                    <RotateCcwIcon data-icon="inline-start" />
                    Try again
                  </Button>
                </div>
              }
              className="flex justify-center p-4"
            >
              {pageWidth > 0 && (
                <div ref={pageRef} className="pdf-page shadow-sm ring-1 ring-border">
                  <Page
                    pageNumber={page}
                    width={pageWidth}
                    renderAnnotationLayer={false}
                    customTextRenderer={renderText}
                    onRenderTextLayerSuccess={onTextLayerRendered}
                    loading={<PageSkeleton width={pageWidth} />}
                    canvasBackground="white"
                  />
                </div>
              )}
            </Document>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PageSkeleton({ width }: { width?: number }) {
  return (
    <div className="flex justify-center" aria-busy="true" aria-label="Loading page">
      <Skeleton className="aspect-[1/1.414] rounded-none" style={{ width: width ?? "min(100%, 40rem)" }} />
    </div>
  );
}
