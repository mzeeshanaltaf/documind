import type { Deck } from "@/game/world/office/presentation/slides";
import { SIMTORA_DECK } from "./simtora-deck";

/**
 * Authored "About {Org}" decks (phase O7); other orgs get `deckFor`'s generated one. Kept apart
 * from the location overrides (`./index.ts`) so the picker pages don't bundle slide content.
 */
export const ORG_DECKS: Record<string, Deck> = {
  simtora: SIMTORA_DECK,
};
