import { countryName } from "@/lib/locations";

/**
 * Per-department room themes (README › Rooms): the decor set, the accent (rug, shelves, door
 * sign, the expert's top, the card stripe), what the expert can help with, and suggested first
 * questions. Simtora's rooms get location-flavoured questions (phase O6 › Rooms). Unknown
 * departments use the generic meeting room.
 */
export type Decor = "hr" | "it" | "finance" | "procurement" | "facilities" | "compliance" | "international" | "generic";

export type RoomTheme = {
  decor: Decor;
  /** What the department's expert can help with, one line (reception's card picker, the room's screen). */
  blurb: string;
  /** Game content, plain sRGB. */
  accent: string;
  /** The greeting's "I look after {area} for the Lahore team". */
  area: string;
  /** The greeting's "Ask me anything about {topics}." */
  topics: string;
  /** 3–5 generic first questions. */
  suggestedQuestions: string[];
  /** Simtora: questions flavoured by the office's country ("in Pakistan") and city. */
  local?: (where: { country: string; city: string }) => string[];
};

/** "Pakistan", but "the United Kingdom". */
export function countryPhrase(code: string): string {
  const name = countryName(code);
  return /^(United |Netherlands|Philippines|Czech)/.test(name) ? `the ${name}` : name;
}

export const ROOM_THEMES: Record<string, RoomTheme> = {
  HR: {
    decor: "hr",
    blurb: "Leave, benefits, working hours and conduct",
    accent: "#c26a3f",
    area: "People & HR",
    topics: "your leave, benefits or policies",
    suggestedQuestions: ["How many days of annual leave do I get?", "What's the parental leave policy?", "How do I request flexible working?"],
    local: ({ country }) => [
      `How many days of annual leave do I get in ${country}?`,
      `What's the parental leave policy in ${country}?`,
      "How do I request flexible working?",
      "How do I report sick?",
    ],
  },
  IT: {
    decor: "it",
    blurb: "Devices, accounts, passwords and security incidents",
    accent: "#3d6fb0",
    area: "IT and security",
    topics: "laptops, accounts, passwords or a suspicious email",
    suggestedQuestions: ["How do I report a phishing email?", "Can I use my own laptop for work?", "What are the password rules?", "What do I do if I lose my laptop?"],
  },
  Finance: {
    decor: "finance",
    blurb: "Expenses, travel costs, approvals and reimbursement",
    accent: "#2f7d4f",
    area: "Finance",
    topics: "expenses, travel costs or approvals",
    suggestedQuestions: ["What's the limit for a business dinner?", "How do I claim travel expenses?", "Who approves a large expense?"],
    local: ({ city }) => [
      `Can I expense a client dinner in ${city}? What's the limit?`,
      "How do I claim travel expenses?",
      "Who approves a large expense?",
    ],
  },
  Procurement: {
    decor: "procurement",
    blurb: "Purchase orders, suppliers and buying limits",
    accent: "#c08a24",
    area: "Procurement",
    topics: "purchase orders, suppliers or buying limits",
    suggestedQuestions: ["What's the approval limit for a purchase order?", "How do I add a new supplier?", "When do I need three quotes?"],
  },
  Facilities: {
    decor: "facilities",
    blurb: "Offices, desks, safety, access and recycling",
    accent: "#2a8580",
    area: "Facilities",
    topics: "the office, safety, access or recycling",
    suggestedQuestions: ["How do I book a meeting room?", "What do I do in a fire alarm?", "How do I report a broken desk?", "What goes in which recycling bin?"],
    local: ({ city }) => [
      `What do I do in a fire alarm at the ${city} office?`,
      "How do I book a meeting room?",
      "What goes in which recycling bin?",
    ],
  },
  Compliance: {
    decor: "compliance",
    blurb: "Ethics, gifts, conflicts of interest and speaking up",
    accent: "#6f4a8e",
    area: "Ethics and compliance",
    topics: "gifts, conflicts of interest or raising a concern",
    suggestedQuestions: ["Can I accept a gift from a supplier?", "How do I report a concern anonymously?", "What counts as a conflict of interest?"],
  },
  International: {
    decor: "international",
    blurb: "Working across countries, travel and assignments abroad",
    accent: "#b0892e",
    area: "international mobility",
    topics: "working abroad, assignments or travel between offices",
    suggestedQuestions: ["Can I work from another country for a month?", "What are the rules for international assignments?", "Which public holidays apply to me?"],
    local: ({ country }) => [
      `I'm based in ${country}. Can I work from another country for a month?`,
      "What are the rules for international assignments?",
      "Which public holidays apply to me?",
    ],
  },
};

export const GENERIC_THEME: RoomTheme = {
  decor: "generic",
  blurb: "The department's policies and procedures",
  accent: "#5f7069",
  area: "this department",
  topics: "its policies and procedures",
  suggestedQuestions: ["What does this department's policy cover?", "Who do I contact for help?", "What do I need to know as a new joiner?"],
};

export function themeFor(department: string): RoomTheme {
  return ROOM_THEMES[department] ?? GENERIC_THEME;
}

/** Orgs whose rooms get location-flavoured questions (they have authored content). */
const LOCAL_QUESTION_ORGS = new Set(["simtora"]);

/**
 * A room's suggested first questions: Simtora's local ones in a country office; in Worldwide,
 * the chosen country chip's (if any); otherwise the generic ones.
 */
export function roomSuggestions(department: string, orgSlug: string, where: { country: string | null; city: string }): string[] {
  const theme = themeFor(department);
  if (theme.local && where.country && LOCAL_QUESTION_ORGS.has(orgSlug)) {
    return theme.local({ country: countryPhrase(where.country), city: where.city });
  }
  return theme.suggestedQuestions;
}
