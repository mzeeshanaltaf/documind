import { type Persona, RECEPTION_NPC, receptionGreeting, receptionistFor, receptionSuggestions } from "@/content/personas";
import type { OfficeContext } from "@/game/store/game-store";
import { type Scope, scopeFor } from "@/lib/scope";

/**
 * Everything the dialogue panel needs about an NPC in the current office: who they are, what
 * they can see (lib/scope.ts), their static greeting and suggested questions. O5 has the
 * receptionist; O6 adds `expert:<Department>`. Pure.
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
};

export function npcProfile(npc: string, office: OfficeContext | null): NpcProfile | null {
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
    };
  }
  return null;
}
