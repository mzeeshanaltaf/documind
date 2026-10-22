"use client";

import dynamic from "next/dynamic";
import { useGame } from "@/game/store/game-store";

// pdf.js is heavy and browser-only: its chunk loads on the first citation click.
const PdfViewerSheet = dynamic(() => import("./pdf-viewer-sheet").then((m) => m.PdfViewerSheet), { ssr: false });

/**
 * The PDF sheet for the game's viewer state (`useGame().viewer`). Rendered inside the NPC
 * dialogue, so Base UI nests it: Esc and outside clicks close the sheet first, and the
 * conversation underneath stays open.
 */
export function PdfViewer() {
  const orgId = useGame((s) => s.office?.org.id ?? null);
  const request = useGame((s) => s.viewer.request);
  const open = useGame((s) => s.viewer.open);
  if (!orgId || !request) return null;
  return <PdfViewerSheet orgId={orgId} request={request} open={open} onOpenChange={(next) => useGame.getState().setViewerOpen(next)} />;
}
