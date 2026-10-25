import { parseBank, type TriviaBank } from "./bank";

/**
 * Which orgs have a trivia bank (phase O8 › Other orgs). A bank is a JSON file in
 * `src/content/orgs/`, generated offline from the org's PDFs; the file loads as its own chunk
 * when a round starts. Orgs without one show "No trivia for this org yet". Adding a bank is a
 * manual step, documented in `office/CLAUDE.md`.
 */
const BANKS: Record<string, () => Promise<unknown>> = {
  simtora: () => import("@/content/orgs/simtora-trivia.json").then((module) => module.default),
};

export const hasTriviaBank = (orgSlug: string): boolean => Object.hasOwn(BANKS, orgSlug);

/** The org's bank, validated; null when the org has none. A malformed file throws. */
export async function loadTriviaBank(orgSlug: string): Promise<TriviaBank | null> {
  if (!hasTriviaBank(orgSlug)) return null;
  return parseBank(await BANKS[orgSlug]());
}
