import { emit } from "@/game/quests/bus";
import { useGame, type ViewerRequest } from "@/game/store/game-store";
import type { Citation, DocumentOut, Source } from "@/lib/api-types";
import type { NpcTurn } from "./sse";

/**
 * An answer's citations (phase O6 › Citations): what a chip [n] points at, the "Sources" list, and
 * the viewer request a click makes. The citation (with the passage to highlight) wins over the
 * live source once it arrives. Pure, except `openCitation`.
 */
export type CitationTarget = Source & Partial<Pick<Citation, "snippet" | "highlight_text" | "section_path">>;

export function citationTargets(turn: Pick<NpcTurn, "sources" | "citations">): { byNumber: Map<number, CitationTarget>; cited: CitationTarget[] } {
  const byNumber = new Map<number, CitationTarget>();
  for (const source of turn.sources) byNumber.set(source.n, source);
  for (const citation of turn.citations) byNumber.set(citation.n, { ...byNumber.get(citation.n), ...citation });
  const cited = turn.citations.map((citation) => byNumber.get(citation.n) ?? citation);
  return { byNumber, cited };
}

/** The viewer request for a citation: its first page, and the passage to mark. */
export function viewerRequest(target: CitationTarget, npc: string | null, documents: Pick<DocumentOut, "id" | "department">[]): ViewerRequest {
  return {
    documentId: target.document_id,
    title: target.title,
    docCode: target.doc_code,
    page: target.page_start,
    pageEnd: target.page_end,
    highlightText: target.highlight_text ?? target.text ?? null,
    npc,
    department: documents.find((doc) => doc.id === target.document_id)?.department ?? null,
  };
}

/** Opens the PDF sheet at the citation and emits `citation_opened`. */
export function openCitation(target: CitationTarget, npc: string | null) {
  const state = useGame.getState();
  const request = viewerRequest(target, npc, state.office?.documents ?? []);
  state.openViewer(request);
  emit({ type: "citation_opened", doc_code: target.doc_code, department: request.department });
}
