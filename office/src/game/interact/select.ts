/** Which interactable the player is focused on (phase O2 › Interaction). Pure; Vitest-tested. */

export type Vec3 = readonly [number, number, number];

export type InteractKind = "talk" | "sit" | "read" | "open" | "use" | "play";

export type Candidate = {
  id: string;
  kind: InteractKind;
  label: string;
  /** Horizontal reach in metres. */
  radius: number;
  position: Vec3;
  /** e.g. `card:HR`. Unmet, the prompt shows a lock and the reason instead of acting. */
  requires?: string;
  lockedReason?: string;
};

export type Focus = {
  id: string;
  kind: InteractKind;
  label: string;
  locked: boolean;
  reason?: string;
};

/** Interactables more than this far above or below the player (another floor) are out of reach. */
export const MAX_HEIGHT_GAP = 2;

/** The default lock reason for a requirement. */
export function requirementReason(requires: string): string {
  const [type, value] = requires.split(":", 2);
  if (type === "card" && value === "*") return "You need an access card · Visit Reception";
  if (type === "card" && value) return `You need ${article(value)} ${value} card · Visit Reception`;
  return "Locked";
}

/** "an HR", "an IT", "a Finance", "an International": acronyms go by the letter's sound. */
function article(word: string): "a" | "an" {
  const acronym = /^[A-Z]{2,5}$/.test(word);
  return (acronym ? /^[AEFHILMNORSX]/ : /^[AEIOU]/i).test(word) ? "an" : "a";
}

/**
 * `card:HR` needs the HR card, `card:*` any card, `unlock:rooftop` the unlock the quests grant
 * (`unlocks`, O9); any other requirement is unmet.
 */
export function meetsRequirement(cards: readonly string[], requirement: string, unlocks: readonly string[] = []): boolean {
  const [type, value] = requirement.split(":", 2);
  if (type === "card") return value === "*" ? cards.length > 0 : cards.includes(value);
  if (type === "unlock") return unlocks.includes(value);
  return false;
}

/**
 * The nearest candidate within its own radius (measured on the floor plane), or null. Ties go to
 * the first registered. Locked candidates are still focused, so the prompt can say why.
 */
export function selectFocused(
  candidates: Iterable<Candidate>,
  player: Vec3,
  has: (requirement: string) => boolean,
): Focus | null {
  let best: Candidate | null = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    if (Math.abs(candidate.position[1] - player[1]) > MAX_HEIGHT_GAP) continue;
    const distance = Math.hypot(candidate.position[0] - player[0], candidate.position[2] - player[2]);
    if (distance <= candidate.radius && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  if (!best) return null;
  const locked = best.requires !== undefined && !has(best.requires);
  return {
    id: best.id,
    kind: best.kind,
    label: best.label,
    locked,
    reason: locked ? (best.lockedReason ?? requirementReason(best.requires!)) : undefined,
  };
}

export function sameFocus(a: Focus | null, b: Focus | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id === b.id && a.locked === b.locked && a.label === b.label && a.reason === b.reason;
}
