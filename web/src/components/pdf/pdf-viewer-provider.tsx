"use client";

import dynamic from "next/dynamic";
import { createContext, use, useCallback, useMemo, useState } from "react";

export type ViewerRequest = {
  documentId: string;
  title: string;
  docCode?: string | null;
  /** 1-based page to open at. */
  page?: number | null;
  /** Last page of the cited passage (highlighting stays within page..pageEnd). */
  pageEnd?: number | null;
  /** The cited chunk text; omitted when just viewing a document. */
  highlightText?: string | null;
};

type OpenRequest = ViewerRequest & { nonce: number };

type ViewerContextValue = { openDocument: (request: ViewerRequest) => void };

const ViewerContext = createContext<ViewerContextValue | null>(null);

// pdf.js only runs in the browser and is heavy: load it on the first open.
const PdfViewerSheet = dynamic(() => import("./pdf-viewer-sheet").then((m) => m.PdfViewerSheet), {
  ssr: false,
});

export function PdfViewerProvider({ orgId, children }: { orgId: string; children: React.ReactNode }) {
  const [request, setRequest] = useState<OpenRequest | null>(null);
  const [open, setOpen] = useState(false);

  const openDocument = useCallback((next: ViewerRequest) => {
    setRequest((prev) => ({ ...next, nonce: (prev?.nonce ?? 0) + 1 }));
    setOpen(true);
  }, []);

  const value = useMemo(() => ({ openDocument }), [openDocument]);

  return (
    <ViewerContext value={value}>
      {children}
      {request && <PdfViewerSheet orgId={orgId} request={request} open={open} onOpenChange={setOpen} />}
    </ViewerContext>
  );
}

export function usePdfViewer(): ViewerContextValue {
  const context = use(ViewerContext);
  if (!context) throw new Error("usePdfViewer must be used inside <PdfViewerProvider>.");
  return context;
}

export function documentFileUrl(orgId: string, documentId: string) {
  return `/api/backend/orgs/${encodeURIComponent(orgId)}/documents/${encodeURIComponent(documentId)}/file`;
}
