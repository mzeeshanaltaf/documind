import { useMemo } from "react";
import useSWR from "swr";
import { ORG_DECKS } from "@/content/orgs/decks";
import { emit } from "@/game/quests/bus";
import { useGame } from "@/game/store/game-store";
import { fetchJson } from "@/lib/quota";
import { decksFor, overviewDocument } from "./decks";
import { markSeen, type ProgrammeSlide, programmeOf, wrapSlide } from "./slides";

/** The org that stands in for the dev sandbox (no office context). */
const SANDBOX_ORG = { name: "Simtora Technologies, Inc.", slug: "simtora" };

/**
 * The presentation room's loop for the current office: DocuMind's deck, then the org's. An org
 * without an authored deck needs its overview's summary (`GET …/documents/{id}`, through the BFF);
 * its summary slides appear once that arrives.
 */
export function useProgramme(): ProgrammeSlide[] {
  const office = useGame((s) => s.office);
  const org = office?.org ?? SANDBOX_ORG;
  const documents = office?.documents;
  const overview = useMemo(() => (documents ? overviewDocument(documents) : null), [documents]);
  const { data } = useSWR<{ summary: string | null }>(
    office && overview && !ORG_DECKS[org.slug] ? `/api/backend/orgs/${office.org.id}/documents/${overview.id}` : null,
    fetchJson,
    { revalidateOnFocus: false },
  );
  const summary = data?.summary ?? null;

  return useMemo(() => {
    const docs = (documents ?? []).map((doc) => (overview && doc.id === overview.id ? { ...doc, summary } : doc));
    return programmeOf(decksFor(org, docs));
  }, [org, documents, overview, summary]);
}

/** The programme entry on screen now. */
export function currentEntry(programme: ProgrammeSlide[], index: number): ProgrammeSlide | null {
  return programme.length > 0 ? programme[wrapSlide(index, programme.length)] : null;
}

/** Records a slide as seen; the deck's last unseen slide emits `presentation_watched` (once). */
export function seeSlide(entry: ProgrammeSlide) {
  const state = useGame.getState();
  const { seen, completed } = markSeen(state.presentation.seen, entry.deck, entry.slide.id);
  if (seen === state.presentation.seen) return;
  state.setSeenSlides(seen);
  if (completed) emit({ type: "presentation_watched", deck: entry.deck.id, location: state.office?.place.id });
}
