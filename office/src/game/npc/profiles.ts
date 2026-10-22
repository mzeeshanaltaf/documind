import {
  EXPERT_PREFIX,
  expertFor,
  expertGreeting,
  type Persona,
  PRESENTER_NPC,
  presenterFor,
  presenterGreeting,
  presenterSuggestions,
  RECEPTION_NPC,
  receptionGreeting,
  receptionistFor,
  receptionSuggestions,
} from "@/content/personas";
import { roomSuggestions } from "@/content/room-themes";
import type { OfficeContext } from "@/game/store/game-store";
import { isSearchable } from "@/lib/api-types";
import { countryName } from "@/lib/locations";
import { type Scope, type ScopeDocument, scopeFor } from "@/lib/scope";

/**
 * Everything the dialogue panel needs about an NPC in the current office: who they are, what
 * they can see (lib/scope.ts), their static greeting and suggested questions. The receptionist
 * (O5) and the department experts, `expert:<Department>` (O6). Pure.
 */
export type NpcProfile = {
  persona: Persona;
  /** Null at reception. */
  department: string | null;
  greeting: string;
  suggestions: string[];
  scope: Scope;
  /** Reception opens on a menu (ask, cards, look); experts go straight to the chat. */
  menu: boolean;
  /**
   * Worldwide rooms with country supplements: the chip row's countries (ISO codes), and the one
   * picked (null = "All"). Empty elsewhere.
   */
  countries: string[];
  country: string | null;
  /** What the dialogue says when `scope.fallback` is set. */
  fallbackNote: string;
};

/**
 * The countries a Worldwide room's chip row offers: the jurisdictions of the department's
 * country supplements (in document-code order: HR-101 PK, 102 DE…), then any other national
 * documents (the US base manual). Empty when the department has no country supplement.
 */
export function scopeCountries(documents: ScopeDocument[], department: string): string[] {
  const docs = documents
    .filter((d) => isSearchable(d) && d.department === department && d.jurisdiction && d.jurisdiction !== "GLOBAL")
    .toSorted((a, b) => (a.doc_code ?? a.title).localeCompare(b.doc_code ?? b.title));
  if (!docs.some((d) => d.doc_type === "country_supplement")) return [];
  const supplements = docs.filter((d) => d.doc_type === "country_supplement");
  const others = docs.filter((d) => d.doc_type !== "country_supplement");
  return [...new Set([...supplements, ...others].map((d) => d.jurisdiction as string))];
}

const NO_LOCAL = "No local documents for this office, so I'm answering from every document.";

/** `country` is the Worldwide chip for this NPC's thread (ignored in a country office). */
export function npcProfile(npc: string, office: OfficeContext | null, country: string | null = null): NpcProfile | null {
  if (!office) return null;
  const { org, place, documents } = office;
  if (npc === RECEPTION_NPC) {
    const persona = receptionistFor(org.slug, place);
    return {
      persona,
      department: null,
      greeting: receptionGreeting(persona, org.name, place),
      suggestions: receptionSuggestions(place),
      scope: scopeFor(documents, { country: place.country, placeName: place.name }),
      menu: true,
      countries: [],
      country: null,
      fallbackNote: NO_LOCAL,
    };
  }
  if (npc === PRESENTER_NPC) {
    const persona = presenterFor(org.slug);
    const scope = scopeFor(documents, { country: place.country, overviewOnly: true, placeName: place.name });
    return {
      persona,
      department: null,
      greeting: presenterGreeting(persona, org.name, !scope.fallback),
      suggestions: presenterSuggestions(org.slug, org.name),
      scope,
      menu: false,
      countries: [],
      country: null,
      fallbackNote: "There's no company overview document, so I'm answering from this office's documents.",
    };
  }
  if (npc.startsWith(EXPERT_PREFIX)) {
    const department = npc.slice(EXPERT_PREFIX.length);
    const persona = expertFor(org.slug, place, department);
    const worldwide = place.country === null;
    const countries = worldwide ? scopeCountries(documents, department) : [];
    const chip = worldwide && country && countries.includes(country) ? country : null;
    const effective = worldwide ? chip : place.country;
    return {
      persona,
      department,
      greeting: expertGreeting(persona, place, department),
      suggestions: roomSuggestions(department, org.slug, { country: effective, city: place.name }),
      scope: scopeFor(documents, { department, country: effective, placeName: chip ? countryName(chip) : place.name }),
      menu: false,
      countries,
      country: chip,
      fallbackNote: `No local documents for this office, so I'm answering from every ${department} document.`,
    };
  }
  return null;
}
