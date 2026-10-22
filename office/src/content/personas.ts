import type { AvatarColors } from "@/game/player/avatar-style";
import { shortOrgName } from "@/lib/format";
import { countryName, type Location } from "@/lib/locations";

/**
 * NPC personas (README › Rooms). O5 has the receptionist per office (Simtora: a name that fits
 * each city) plus a generic one; O6 adds the department experts. Greetings and call-outs are
 * static text: they never use the quota.
 */
export type Persona = {
  /** The NPC id: the chat slice key and the bus events use it. */
  id: string;
  name: string;
  role: string;
  colors: AvatarColors;
};

type ReceptionistSeed = { name: string; colors: AvatarColors };

const SIMTORA_RECEPTION: Record<string, ReceptionistSeed> = {
  "san-francisco": {
    name: "Maya Torres",
    colors: { skin: "#c68a5e", hair: "#2f241d", top: "#2c3e63", bottom: "#3a4048", shoes: "#26292c", badge: "#e7c74a" },
  },
  lahore: {
    name: "Sara Malik",
    colors: { skin: "#a46a43", hair: "#1d1a19", top: "#2f6f5e", bottom: "#222326", shoes: "#5a3a26", badge: "#e7c74a" },
  },
  berlin: {
    name: "Lena Hoffmann",
    colors: { skin: "#f3d5c0", hair: "#d1a65a", top: "#3a4a5c", bottom: "#3a4048", shoes: "#26292c", badge: "#e7c74a" },
  },
  paris: {
    name: "Camille Laurent",
    colors: { skin: "#e2b48f", hair: "#6b3f22", top: "#9c4535", bottom: "#222326", shoes: "#26292c", badge: "#e7c74a" },
  },
  sydney: {
    name: "Chloe Nguyen",
    colors: { skin: "#e2b48f", hair: "#1d1a19", top: "#2a7fa8", bottom: "#bdb6a8", shoes: "#e8e6e1", badge: "#e7c74a" },
  },
  london: {
    name: "Priya Shah",
    colors: { skin: "#a46a43", hair: "#1d1a19", top: "#5e3a5c", bottom: "#3a4048", shoes: "#26292c", badge: "#e7c74a" },
  },
  worldwide: {
    name: "Ada Okafor",
    colors: { skin: "#7a4a2c", hair: "#1d1a19", top: "#c99a2e", bottom: "#3a4048", shoes: "#5a3a26", badge: "#e7c74a" },
  },
};

const GENERIC_RECEPTION: ReceptionistSeed = {
  name: "Alex Morgan",
  colors: { skin: "#c68a5e", hair: "#6b3f22", top: "#2f6f5e", bottom: "#3a4048", shoes: "#26292c", badge: "#e7c74a" },
};

const RECEPTION: Record<string, Record<string, ReceptionistSeed>> = { simtora: SIMTORA_RECEPTION };

export const RECEPTION_NPC = "reception";

export type PlaceRef = Pick<Location, "id" | "name" | "role" | "country">;

/** The office's receptionist: the org's own for that city, or the generic one. */
export function receptionistFor(orgSlug: string, place: PlaceRef): Persona {
  const seed = RECEPTION[orgSlug]?.[place.id] ?? GENERIC_RECEPTION;
  return { id: RECEPTION_NPC, name: seed.name, role: "Reception", colors: seed.colors };
}

export function firstName(persona: Persona): string {
  return persona.name.split(" ")[0];
}

/** "Simtora Lahore", or "the Simtora Global Hub". */
function officeName(orgName: string, place: PlaceRef) {
  const org = shortOrgName(orgName);
  return place.role === "hub" ? `the ${org} ${place.name}` : `${org} ${place.name}`;
}

/** The static greeting at the top of the transcript. */
export function receptionGreeting(persona: Persona, orgName: string, place: PlaceRef): string {
  return `Welcome to ${officeName(orgName, place)}! I'm ${firstName(persona)}. Ask me anything about company policy, or pick up your access cards for the department rooms.`;
}

/** Called out once, the first time the player comes within 6 m. */
export function receptionCallout(orgName: string, place: PlaceRef): string {
  return `Welcome to ${officeName(orgName, place)}! Come get your badge.`;
}

/** Suggested first questions at reception, flavoured by the office's country. */
export function receptionSuggestions(place: PlaceRef): string[] {
  if (!place.country) {
    return ["What's the parental leave policy in Germany?", "Can I accept a gift from a supplier?", "How do I claim travel expenses?"];
  }
  const country = countryName(place.country);
  return [
    `How many days of annual leave do I get in ${/^United /.test(country) ? `the ${country}` : country}?`,
    "What's the limit for a business dinner?",
    "How do I report a phishing email?",
  ];
}
