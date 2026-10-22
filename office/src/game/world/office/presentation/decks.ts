import { DOCUMIND_DECK } from "@/content/documind-deck";
import { ORG_DECKS } from "@/content/orgs/decks";
import { themeFor } from "@/content/room-themes";
import { type DocumentOut, isSearchable } from "@/lib/api-types";
import { roomDepartments } from "@/lib/departments";
import { shortOrgName } from "@/lib/format";
import { countryName } from "@/lib/locations";
import type { Deck, Slide } from "./slides";

/**
 * The presentation room's decks (phase O7 › Decks): DocuMind's, then "About {Org}". Simtora has
 * an authored deck; any other org gets one generated from its documents. Pure.
 */
export type DeckDocument = Pick<DocumentOut, "id" | "title" | "doc_code" | "department" | "jurisdiction" | "doc_type" | "indexed_at"> & {
  /** The overview's catalog summary (`GET …/documents/{id}`); absent until it's fetched. */
  summary?: string | null;
};

type DeckOrg = { name: string; slug: string };

/** A slide's typical time on screen when it's generated. */
const GENERATED_SECONDS = 13;

/** The searchable overview document, if the org has one (README › Chat scoping, rule 5). */
export function overviewDocument<T extends Pick<DeckDocument, "doc_type" | "indexed_at">>(documents: T[]): T | null {
  return documents.find((doc) => isSearchable(doc) && doc.doc_type === "overview") ?? null;
}

/** Splits a summary into sentences (keeping abbreviations like "U.S." whole), then into ≤ 3 runs. */
export function summaryParts(summary: string, parts = 3): string[] {
  const sentences = summary
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  if (sentences.length <= parts) return sentences;
  // Balanced runs, the longer ones first: 4 sentences → 2, 1, 1.
  const base = Math.floor(sentences.length / parts);
  const extra = sentences.length % parts;
  const runs: string[] = [];
  let at = 0;
  for (let i = 0; i < parts; i++) {
    const size = base + (i < extra ? 1 : 0);
    runs.push(sentences.slice(at, at + size).join(" "));
    at += size;
  }
  return runs;
}

/** The org's "About" deck: its authored one, or a title, its overview summary, its library and rooms. */
export function deckFor(org: DeckOrg, documents: DeckDocument[]): Deck {
  const authored = ORG_DECKS[org.slug];
  if (authored) return authored;

  const short = shortOrgName(org.name);
  const searchable = documents.filter(isSearchable);
  const overview = overviewDocument(searchable);
  const code = overview ? (overview.doc_code ?? overview.title) : null;
  const slides: Slide[] = [];

  if (overview) {
    slides.push({
      id: "title",
      kind: "title",
      title: `About ${short}`,
      body: `An introduction drawn from ${overview.title}.`,
      source: code ?? undefined,
      speakerLine: `Welcome to ${short}. Here's who we are, in a few slides.`,
      durationS: 10,
    });
    const parts = overview.summary ? summaryParts(overview.summary) : [];
    parts.forEach((text, index) => {
      slides.push({
        id: `summary-${index + 1}`,
        kind: "title",
        title: parts.length > 1 ? `In brief, ${index + 1} of ${parts.length}` : "In brief",
        body: text,
        source: `From the summary of ${code}`,
        speakerLine: index === 0 ? `This is ${short} in brief, from our company overview.` : "Ask me if you'd like more detail on any of it.",
        durationS: GENERATED_SECONDS,
      });
    });
  }

  const departments = roomDepartments(searchable);
  const countries = [...new Set(searchable.map((doc) => doc.jurisdiction).filter((j): j is string => !!j && j !== "GLOBAL"))].sort();
  slides.push({
    id: "library",
    kind: "stat-grid",
    title: `${short}'s library`,
    stats: [
      { label: "Documents", value: String(searchable.length), note: "Searchable in DocuMind" },
      {
        label: "Departments",
        value: String(new Set(searchable.map((doc) => doc.department).filter(Boolean)).size),
        note: departments.length > 0 ? `${departments.length} with a room in this office` : "No department rooms yet",
      },
      {
        label: "Countries",
        value: String(countries.length),
        note: countries.length > 0 ? countries.map(countryName).join(", ") : "Every document applies everywhere",
      },
    ],
    speakerLine: `Everything ${short} has written down, in one place.`,
    durationS: GENERATED_SECONDS,
  });

  slides.push({
    id: "departments",
    kind: "bullets",
    title: "Your departments",
    body: departments.length > 0 ? "Each has a room down the corridor, with an expert who answers from its documents." : "The corridor's rooms open once department documents are added.",
    items: departments.map((department) => ({ term: department, text: themeFor(department).blurb, room: department })),
    speakerLine: "Pick up your cards at Reception, then visit the rooms. The experts answer from the documents.",
    durationS: GENERATED_SECONDS,
  });

  return { id: "company", title: `About ${short}`, slides };
}

/** The whole loop for an org: DocuMind first, then the org's deck. */
export function decksFor(org: DeckOrg, documents: DeckDocument[]): Deck[] {
  return [DOCUMIND_DECK, deckFor(org, documents)];
}
