import type { AvatarColors } from "@/game/player/avatar-style";
import { shortOrgName } from "@/lib/format";
import { countryName, type Location } from "@/lib/locations";
import { themeFor } from "./room-themes";

/**
 * NPC personas (README › Rooms): the receptionist per office (Simtora: a name that fits each
 * city) plus a generic one (O5), and a department expert per (department, office) with generic
 * ones as the fallback (O6). Greetings and call-outs are static text: they never use the quota.
 */
/** What an expert holds while idle. */
export type IdleProp = "clipboard" | "laptop" | "mug";

export type Persona = {
  /** The NPC id: the chat slice key and the bus events use it. */
  id: string;
  name: string;
  role: string;
  colors: AvatarColors;
  prop?: IdleProp;
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

// --- Department experts (O6) ------------------------------------------------------------------

export const EXPERT_PREFIX = "expert:";
export const expertNpc = (department: string) => `${EXPERT_PREFIX}${department}`;

/** Compact seeds: name, skin and hair (indices into the palettes below), the idle prop. */
type ExpertSeed = readonly [name: string, skin: number, hair: number, prop: IdleProp];

const SKIN = ["#f3d5c0", "#e2b48f", "#c68a5e", "#a46a43", "#7a4a2c", "#4b2e1e"];
const HAIR = ["#1d1a19", "#2f241d", "#6b3f22", "#8f3b1f", "#d1a65a", "#a7a7a2"];
const BOTTOM = ["#3a4048", "#222326", "#3d5a80", "#59603e", "#a39071"];
const SHOES = ["#26292c", "#5a3a26", "#26292c", "#e8e6e1"];

/** Simtora's experts per office id, one per department (README › Rooms). */
const SIMTORA_EXPERTS: Record<string, Record<string, ExpertSeed>> = {
  "san-francisco": {
    HR: ["Jasmine Carter", 4, 0, "clipboard"],
    IT: ["Ethan Brooks", 0, 4, "laptop"],
    Finance: ["Marcus Lee", 1, 0, "laptop"],
    Procurement: ["Olivia Ramirez", 2, 2, "clipboard"],
    Facilities: ["Diego Hernandez", 2, 1, "clipboard"],
    Compliance: ["Rachel Kim", 1, 0, "mug"],
    International: ["Nora Bennett", 0, 3, "mug"],
  },
  lahore: {
    HR: ["Hina Raza", 3, 0, "clipboard"],
    IT: ["Shehzad Ahmed", 3, 1, "laptop"],
    Finance: ["Ayesha Siddiqui", 2, 0, "laptop"],
    Procurement: ["Usman Tariq", 3, 0, "clipboard"],
    Facilities: ["Kamran Iqbal", 4, 1, "clipboard"],
    Compliance: ["Zainab Qureshi", 2, 1, "mug"],
    International: ["Faisal Khan", 3, 5, "mug"],
  },
  berlin: {
    HR: ["Katrin Weber", 0, 4, "clipboard"],
    IT: ["Jonas Becker", 0, 2, "laptop"],
    Finance: ["Felix Wagner", 1, 1, "laptop"],
    Procurement: ["Anna Schulz", 0, 3, "clipboard"],
    Facilities: ["Tobias Richter", 1, 5, "clipboard"],
    Compliance: ["Miriam Schäfer", 0, 1, "mug"],
    International: ["Leon Fischer", 2, 0, "mug"],
  },
  paris: {
    HR: ["Élodie Martin", 1, 2, "clipboard"],
    IT: ["Hugo Bernard", 0, 1, "laptop"],
    Finance: ["Claire Dubois", 0, 4, "laptop"],
    Procurement: ["Julien Moreau", 1, 0, "clipboard"],
    Facilities: ["Antoine Petit", 2, 1, "clipboard"],
    Compliance: ["Sophie Lefèvre", 0, 3, "mug"],
    International: ["Inès Garnier", 4, 0, "mug"],
  },
  sydney: {
    HR: ["Emma Wilson", 0, 4, "clipboard"],
    IT: ["Liam O'Brien", 0, 3, "laptop"],
    Finance: ["Grace Chen", 1, 0, "laptop"],
    Procurement: ["Jack Thompson", 1, 2, "clipboard"],
    Facilities: ["Mia Walker", 2, 1, "clipboard"],
    Compliance: ["Noah Taylor", 4, 0, "mug"],
    International: ["Ruby Patel", 3, 0, "mug"],
  },
  london: {
    HR: ["Charlotte Hughes", 0, 2, "clipboard"],
    IT: ["Oliver Clarke", 1, 1, "laptop"],
    Finance: ["Amara Okoye", 5, 0, "laptop"],
    Procurement: ["Harry Evans", 0, 4, "clipboard"],
    Facilities: ["George Wright", 1, 5, "clipboard"],
    Compliance: ["Imogen Price", 0, 3, "mug"],
    International: ["Arjun Mehta", 3, 0, "mug"],
  },
  worldwide: {
    HR: ["Sofia Alvarez", 2, 2, "clipboard"],
    IT: ["Kenji Tanaka", 1, 0, "laptop"],
    Finance: ["Fatima Haddad", 2, 0, "laptop"],
    Procurement: ["Lucas Silva", 2, 1, "clipboard"],
    Facilities: ["Ingrid Larsen", 0, 4, "clipboard"],
    Compliance: ["Daniel Mensah", 5, 0, "mug"],
    International: ["Mei Lin", 1, 0, "mug"],
  },
};

/** Any org (and any department Simtora's table lacks). */
const GENERIC_EXPERTS: Record<string, ExpertSeed> = {
  HR: ["Sam Rivera", 2, 1, "clipboard"],
  IT: ["Chris Park", 1, 0, "laptop"],
  Finance: ["Taylor Brooks", 4, 0, "laptop"],
  Procurement: ["Robin Hayes", 0, 2, "clipboard"],
  Facilities: ["Alex Novak", 1, 1, "clipboard"],
  Compliance: ["Morgan Ellis", 3, 0, "mug"],
  International: ["Jamie Okafor", 4, 0, "mug"],
  Legal: ["Casey Lin", 1, 0, "laptop"],
  Operations: ["Riley Shah", 3, 1, "clipboard"],
};
const FALLBACK_EXPERT: ExpertSeed = ["Jordan Lee", 2, 1, "clipboard"];

const EXPERTS: Record<string, Record<string, Record<string, ExpertSeed>>> = { simtora: SIMTORA_EXPERTS };

function hashIndex(value: string, length: number): number {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % length;
}

/** The room's expert: the org's own for this office and department, else the generic one. */
export function expertFor(orgSlug: string, place: PlaceRef, department: string): Persona {
  const [name, skin, hair, prop] = EXPERTS[orgSlug]?.[place.id]?.[department] ?? GENERIC_EXPERTS[department] ?? FALLBACK_EXPERT;
  const pick = hashIndex(name, 97);
  return {
    id: expertNpc(department),
    name,
    role: department,
    // They wear the room's colour; trousers and shoes vary by name.
    colors: {
      skin: SKIN[skin] ?? SKIN[2],
      hair: HAIR[hair] ?? HAIR[0],
      top: themeFor(department).accent,
      bottom: BOTTOM[pick % BOTTOM.length],
      shoes: SHOES[pick % SHOES.length],
      badge: "#e7c74a",
    },
    prop,
  };
}

/** "Hi, I'm Hina, I look after People & HR for the Lahore team. Ask me anything about …" */
export function expertGreeting(persona: Persona, place: PlaceRef, department: string): string {
  const theme = themeFor(department);
  const team = place.role === "hub" ? "across all our offices" : `for the ${place.name} team`;
  return `Hi, I'm ${firstName(persona)}, I look after ${theme.area} ${team}. Ask me anything about ${theme.topics}.`;
}

// --- The presenter (O7) ---------------------------------------------------------------------

export const PRESENTER_NPC = "presenter";

const PRESENTERS: Record<string, ReceptionistSeed> = {
  simtora: {
    name: "Noor Abbasi",
    colors: { skin: "#c68a5e", hair: "#1d1a19", top: "#1a5d48", bottom: "#222326", shoes: "#26292c", badge: "#e7c74a" },
  },
};

const GENERIC_PRESENTER: ReceptionistSeed = {
  name: "Sam Okoro",
  colors: { skin: "#7a4a2c", hair: "#1d1a19", top: "#1a5d48", bottom: "#3a4048", shoes: "#26292c", badge: "#e7c74a" },
};

/** Whoever runs the presentation room: the org's own, or the generic one. Holds the clicker. */
export function presenterFor(orgSlug: string): Persona {
  const seed = PRESENTERS[orgSlug] ?? GENERIC_PRESENTER;
  return { id: PRESENTER_NPC, name: seed.name, role: "Presenter", colors: seed.colors, prop: "clipboard" };
}

/** The presenter's static greeting; `hasOverview` = the org has a searchable overview document. */
export function presenterGreeting(persona: Persona, orgName: string, hasOverview: boolean): string {
  const org = shortOrgName(orgName);
  return hasOverview
    ? `Hi, I'm ${firstName(persona)}, and this is the ${org} presentation. Ask me anything about the company: its story, offices, products or people. I answer from the company overview.`
    : `Hi, I'm ${firstName(persona)}, and this is the ${org} presentation. There's no company overview document yet, so I answer from all of ${org}'s documents.`;
}

/** Suggested questions for the presenter (phase O7 › Presenter Q&A). */
export function presenterSuggestions(orgSlug: string, orgName: string): string[] {
  if (orgSlug === "simtora") return ["When was Simtora founded?", "Where are the R&D centres?", "What are the company values?"];
  const org = shortOrgName(orgName);
  return [`What does ${org} do?`, `Where are ${org}'s offices?`, "What are the company values?"];
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
