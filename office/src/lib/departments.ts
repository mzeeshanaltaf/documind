import { type DocumentOut, isSearchable } from "./api-types";

/**
 * Which departments get a room (phase O5 › Floor plan): one per department of the org's
 * searchable documents, except `Corporate` (the presentation room hosts it). Pure and
 * client-safe: the floor plan and the `issueCards` action share it.
 */
export const ROOM_ORDER = ["HR", "IT", "Finance", "Procurement", "Facilities", "Compliance", "International"];

/** Hosted by the presentation room (O7), so it never gets a department room or a card. */
export const NO_ROOM = new Set(["Corporate"]);

/** Distinct names in room order: the known departments first, then the rest alphabetically. */
export function orderDepartments(departments: Iterable<string>): string[] {
  const unique = [...new Set([...departments].map((d) => d.trim()).filter((d) => d && !NO_ROOM.has(d)))];
  const rank = (d: string) => {
    const index = ROOM_ORDER.indexOf(d);
    return index === -1 ? ROOM_ORDER.length : index;
  };
  return unique.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** The departments that get a room (and a card) for these documents. */
export function roomDepartments(documents: Pick<DocumentOut, "department" | "indexed_at">[]): string[] {
  return orderDepartments(documents.filter(isSearchable).flatMap((d) => (d.department ? [d.department] : [])));
}
