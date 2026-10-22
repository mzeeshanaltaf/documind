/**
 * Per-department room themes. O5 uses the name, the one-line "what you can ask" (the reception
 * card picker) and the accent (the card and the door sign); O6 adds the decor and fills the
 * suggested questions per room. Unknown departments use the generic theme.
 */
export type RoomTheme = {
  /** What the department's expert can help with, one line. */
  blurb: string;
  /** The card stripe and the door sign (game content, plain sRGB). */
  accent: string;
  suggestedQuestions: string[];
};

export const ROOM_THEMES: Record<string, RoomTheme> = {
  HR: {
    blurb: "Leave, benefits, working hours and conduct",
    accent: "#c26a3f",
    suggestedQuestions: ["How many days of annual leave do I get?", "What's the parental leave policy?", "How do I request flexible working?"],
  },
  IT: {
    blurb: "Devices, accounts, passwords and security incidents",
    accent: "#3d6fb0",
    suggestedQuestions: ["How do I report a phishing email?", "Can I use my own laptop for work?", "What are the password rules?"],
  },
  Finance: {
    blurb: "Expenses, travel costs, approvals and reimbursement",
    accent: "#2f7d4f",
    suggestedQuestions: ["What's the limit for a business dinner?", "How do I claim travel expenses?", "Who approves a large expense?"],
  },
  Procurement: {
    blurb: "Purchase orders, suppliers and buying limits",
    accent: "#c08a24",
    suggestedQuestions: ["What's the approval limit for a purchase order?", "How do I add a new supplier?", "When do I need three quotes?"],
  },
  Facilities: {
    blurb: "Offices, desks, safety, access and recycling",
    accent: "#2a8580",
    suggestedQuestions: ["How do I book a meeting room?", "What do I do in a fire alarm?", "How do I report a broken desk?"],
  },
  Compliance: {
    blurb: "Ethics, gifts, conflicts of interest and speaking up",
    accent: "#6f4a8e",
    suggestedQuestions: ["Can I accept a gift from a supplier?", "How do I report a concern anonymously?", "What counts as a conflict of interest?"],
  },
  International: {
    blurb: "Working across countries, travel and assignments abroad",
    accent: "#b0892e",
    suggestedQuestions: ["Can I work from another country for a month?", "What are the rules for international assignments?", "Which public holidays apply to me?"],
  },
};

export const GENERIC_THEME: RoomTheme = {
  blurb: "The department's policies and procedures",
  accent: "#5f7069",
  suggestedQuestions: ["What does this department's policy cover?", "Who do I contact for help?"],
};

export function themeFor(department: string): RoomTheme {
  return ROOM_THEMES[department] ?? GENERIC_THEME;
}
