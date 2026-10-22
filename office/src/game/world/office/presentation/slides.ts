/**
 * The presentation room's slides as data (phase O7 › Slide engine). Pure: the decks, the running
 * programme (DocuMind's deck, then the company's), and the per-deck seen-set that fires
 * `presentation_watched` once every slide of a deck has been seen.
 */
export type SlideKind = "title" | "bullets" | "stat-grid" | "map" | "video" | "quote";

/** One row of a bullets slide: an optional lead term (a year, a step, a role), the text, and a room. */
export type SlideItem = {
  term?: string;
  text: string;
  /** A department whose room in this office covers the item ("HR room"). */
  room?: string;
  /** A document code shown in mono after the text. */
  code?: string;
};

/** A row of a stat grid: read as "label · value", like the overview's at-a-glance table. */
export type SlideStat = { label: string; value: string; note?: string };

/** An office on the map slide; the current office is marked "You are here". */
export type SlidePin = {
  id: string;
  name: string;
  /** Short, for the screen: "R&D centre · about 45". */
  role: string;
  /** Longer, for the readable page: what the office works on. */
  focus: string;
  lat: number;
  lon: number;
  hq?: boolean;
};

export type SlideVideo = { src: string; poster: string; captions: string; durationS: number; hasAudio: boolean };

export type Slide = {
  id: string;
  kind: SlideKind;
  title: string;
  /** The lead paragraph (also the map's caption and the quote's context). */
  body?: string;
  items?: SlideItem[];
  /** Bullets slides: numbered steps (01, 02…) instead of plain rows. */
  numbered?: boolean;
  stats?: SlideStat[];
  quote?: { text: string; source: string };
  pins?: SlidePin[];
  video?: SlideVideo;
  /** A call to open DocuMind itself (`NEXT_PUBLIC_APP_URL`): a link in the readable page. */
  linkToDocuMind?: boolean;
  /** Where the slide's facts come from ("SIM-OVR-001 · p. 3"), shown as a footnote. */
  source?: string;
  /** What the presenter says when the slide comes up (static: no quota). */
  speakerLine: string;
  /** Seconds on screen while it runs by itself (manual while someone is seated). */
  durationS: number;
};

export type DeckId = "documind" | "company";

export type Deck = {
  id: DeckId;
  /** "What DocuMind is", "About Simtora": the part's name on every slide. */
  title: string;
  slides: Slide[];
};

/** One slide of the running programme, with its place in its deck. */
export type ProgrammeSlide = { deck: Deck; slide: Slide; index: number; total: number };

/** The decks back to back; the screen loops through this. */
export function programmeOf(decks: Deck[]): ProgrammeSlide[] {
  return decks.flatMap((deck) => deck.slides.map((slide, index) => ({ deck, slide, index, total: deck.slides.length })));
}

/** Wraps an index into the programme (either direction). */
export function wrapSlide(index: number, count: number): number {
  if (count <= 0) return 0;
  return ((index % count) + count) % count;
}

export type SeenSlides = Partial<Record<DeckId, string[]>>;

/**
 * Records a slide as seen. `completed` is true only for the call that saw a deck's last unseen
 * slide, so `presentation_watched` fires once per deck however often the loop comes round.
 */
export function markSeen(seen: SeenSlides, deck: Deck, slideId: string): { seen: SeenSlides; completed: boolean } {
  const before = seen[deck.id] ?? [];
  if (before.includes(slideId) || !deck.slides.some((slide) => slide.id === slideId)) return { seen, completed: false };
  const after = [...before, slideId];
  const ids = new Set(after);
  const completed = deck.slides.every((slide) => ids.has(slide.id));
  return { seen: { ...seen, [deck.id]: after }, completed };
}

/** True when every slide of the deck is in the seen-set. */
export function deckWatched(seen: SeenSlides, deck: Deck): boolean {
  const ids = new Set(seen[deck.id] ?? []);
  return deck.slides.length > 0 && deck.slides.every((slide) => ids.has(slide.id));
}

/** Equirectangular position of a pin, as fractions of the map's width and height. */
export function pinPosition(pin: Pick<SlidePin, "lat" | "lon">): { x: number; y: number } {
  return { x: (pin.lon + 180) / 360, y: (90 - pin.lat) / 180 };
}
