import { DEPARTMENTS } from "@/lib/api-types";
import { jurisdictionName } from "@/lib/format";
import type { CatalogDoc } from "./types";

/** Four starter questions per department, phrased the way people actually ask. */
const QUESTIONS: Record<string, string[]> = {
  HR: [
    "How many days of paid time off do employees get?",
    "What is the parental leave policy?",
    "How do I raise a grievance?",
    "What are the standard working hours?",
  ],
  IT: [
    "Which AI tools am I allowed to use for work?",
    "Can I use my personal phone for work email?",
    "How do I report a security incident?",
    "What are the password requirements?",
  ],
  Finance: [
    "What expenses can I claim when travelling?",
    "How soon must I submit an expense report?",
    "Who approves spending above my limit?",
    "What is the daily meal allowance on business trips?",
  ],
  Procurement: [
    "What's the approval limit for a purchase order?",
    "When do I need three quotes from suppliers?",
    "How do I onboard a new supplier?",
    "Can I sign a vendor contract myself?",
  ],
  Facilities: [
    "Can I bring my dog to the office?",
    "How do I book a meeting room?",
    "What do I do during a fire evacuation?",
    "Who do I contact about a building repair?",
  ],
  Compliance: [
    "Can I accept a gift from a supplier?",
    "How do I declare a conflict of interest?",
    "How do I report a concern confidentially?",
    "What counts as a bribe?",
  ],
  Corporate: [
    "What does the company do?",
    "Which legal entities are part of the group?",
    "Who owns each policy area?",
    "What are the company's values?",
  ],
  International: [
    "Which policies apply to employees outside the U.S.?",
    "How do country supplements relate to the main manuals?",
    "What changes when an employee works abroad?",
    "Which local rules override the global policy?",
  ],
};

const GENERIC = [
  "What does this policy cover?",
  "Who approves exceptions?",
  "Who is the policy owner?",
  "When was it last reviewed?",
];

export type SuggestionGroup = { department: string; questions: string[] };

const ORDER: readonly string[] = DEPARTMENTS;
const rank = (department: string) => (ORDER.includes(department) ? ORDER.indexOf(department) : ORDER.length);

/** One group per department present in the catalog, in the canonical department order (HR first). */
export function buildSuggestions(docs: CatalogDoc[]): SuggestionGroup[] {
  const departments = [...new Set(docs.map((d) => d.department).filter((d): d is string => !!d))].sort(
    (a, b) => rank(a) - rank(b),
  );
  return departments.map((department) => {
    const questions = [...(QUESTIONS[department] ?? GENERIC)];
    if (department === "HR") {
      // With country supplements, lead with the question they exist to answer.
      const countries = [
        ...new Set(
          docs
            .filter((d) => d.department === "HR" && d.jurisdiction && !["GLOBAL", "US"].includes(d.jurisdiction))
            .map((d) => jurisdictionName(d.jurisdiction)),
        ),
      ];
      if (countries.length) {
        questions[0] = `How much annual leave do employees in ${countries[0]} get?`;
        if (countries[1]) questions[2] = `What's the notice period for employees in ${countries[1]}?`;
      }
    }
    return { department, questions };
  });
}
