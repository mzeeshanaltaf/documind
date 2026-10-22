import type { Deck, SlideVideo } from "@/game/world/office/presentation/slides";

/**
 * Part one of the presentation room's loop: what DocuMind is (phase O7 › Decks). The claims
 * follow the landing page (`web/src/app/(marketing)/page.tsx`) and Status.md › Phase 7: platform
 * admins upload (new sign-ups can't), text goes to OpenAI to index documents and write answers,
 * and no certification is claimed.
 */

/**
 * The hero explainer, copied from `web/public/` (re-sync by hand, see office/CLAUDE.md). It has
 * no sound track, so the seated unmute button stays hidden; set `hasAudio` if a re-render adds one.
 */
export const EXPLAINER: SlideVideo = {
  src: "/video/documind-explainer.mp4",
  poster: "/video/documind-explainer-poster.jpg",
  captions: "/video/documind-explainer.vtt",
  durationS: 18,
  hasAudio: false,
};

export const DOCUMIND_DECK: Deck = {
  id: "documind",
  title: "What DocuMind is",
  slides: [
    {
      id: "problem",
      kind: "quote",
      title: "The answer is in a PDF somewhere",
      quote: { text: "Can I carry over unused leave in Germany?", source: "A question People Ops answers every week" },
      body: "Policies live in long manuals: hundreds of pages of HR, IT and Finance rules, read once at onboarding and searched with Ctrl+F. The same questions come back every week, and the right answer changes by country.",
      speakerLine: "Every company has the answers somewhere. Usually on page 74 of a PDF.",
      durationS: 13,
    },
    {
      id: "explainer",
      kind: "video",
      title: "DocuMind in 18 seconds",
      body: "Upload a manual, let it index, ask in your own words, and open the cited page.",
      video: EXPLAINER,
      speakerLine: "Here's the whole idea in eighteen seconds.",
      durationS: EXPLAINER.durationS + 2,
    },
    {
      id: "how-it-works",
      kind: "bullets",
      title: "How it works",
      numbered: true,
      items: [
        { term: "Upload", text: "Platform admins add the PDFs the company already has. Each file is checked, stored privately and queued." },
        { term: "Index", text: "DocuMind reads each document's header, sections and pages, and tags it with its department, country and type." },
        { term: "Ask", text: "People ask in their own words, about every document or a chosen few." },
        { term: "Cite", text: "Every answer comes with numbered sources that open the PDF at the passage." },
      ],
      speakerLine: "Four steps: upload, index, ask, and cite. Nobody has to learn where a rule lives.",
      durationS: 14,
    },
    {
      id: "hybrid-search",
      kind: "bullets",
      title: "Hybrid search: keywords and meaning",
      items: [
        { term: "Keywords", text: "BM25 ranks passages by the exact words and codes you use, like “carry-over” or SIM-HR-102." },
        { term: "Meaning", text: "Vector search finds passages that say the same thing in other words: “time off” finds annual leave." },
        { term: "Fused", text: "The two rankings are merged into one list (reciprocal rank fusion), so a passage strong on both rises to the top." },
      ],
      speakerLine: "Keywords catch the exact terms, vectors catch the meaning, and DocuMind uses both.",
      durationS: 14,
    },
    {
      id: "agents",
      kind: "bullets",
      title: "Department agents that know the country",
      items: [
        { text: "A router reads each question and hands it to the right department's agent: HR, IT, Finance and the rest." },
        { text: "It works out which country is meant and answers from that country's manual, next to the global rules." },
        { text: "When the answer depends on a country it can't tell, it asks which one you mean." },
      ],
      speakerLine: "A Berlin employee and a Sydney employee can ask the same thing and get different, correct answers.",
      durationS: 13,
    },
    {
      id: "citations",
      kind: "bullets",
      title: "Citations that open the page",
      items: [
        { text: "Every statement carries a numbered citation to the document, section and page it came from." },
        { text: "Click one and the PDF opens at that page, with the passage highlighted." },
        { text: "When the answer isn't in the documents, it says so instead of guessing." },
      ],
      speakerLine: "An answer you can defend is one you can point to. One click shows the passage.",
      durationS: 13,
    },
    {
      id: "organizations",
      kind: "bullets",
      title: "Organizations, members and monthly quotas",
      items: [
        { term: "Organizations", text: "Each has its own documents, members and settings. People only see the ones they belong to." },
        { term: "Roles", text: "Platform admins upload documents and manage members. Everyone else asks and opens the cited pages." },
        { term: "Quotas", text: "Each person has a monthly allowance of messages and tokens: the meter at the top right of this office." },
        { term: "Your data", text: "Text goes to OpenAI only to index documents and write answers. It is never sold." },
      ],
      speakerLine: "Every organization is its own space, and every question counts against a monthly allowance.",
      durationS: 15,
    },
    {
      id: "try-it",
      kind: "title",
      title: "Try it",
      body: "Visit any department in this office, or open DocuMind. Reception hands out the access cards; every expert answers with real DocuMind citations, on your monthly allowance.",
      linkToDocuMind: true,
      speakerLine: "Grab your cards at Reception and go ask someone. Or open DocuMind itself.",
      durationS: 12,
    },
  ],
};
