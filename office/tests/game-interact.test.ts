import { describe, expect, it } from "vitest";
import { type Candidate, meetsRequirement, requirementReason, sameFocus, selectFocused } from "@/game/interact/select";

const chair: Candidate = { id: "chair", kind: "sit", label: "Sit", radius: 1.2, position: [2, 0, 0] };
const npc: Candidate = { id: "hina", kind: "talk", label: "Talk to Hina", radius: 1.8, position: [0, 0, 1.5] };
const door: Candidate = {
  id: "hr-door",
  kind: "open",
  label: "Open the HR room",
  radius: 1.6,
  position: [-1, 0, 0],
  requires: "card:HR",
};

const none = () => false;
const all = () => true;

describe("selectFocused", () => {
  it("returns null when nothing is in range", () => {
    expect(selectFocused([chair, npc], [10, 0, 10], none)).toBeNull();
    expect(selectFocused([], [0, 0, 0], none)).toBeNull();
  });

  it("picks the nearest candidate within its own radius", () => {
    // 1.0 from the chair (radius 1.2), 1.58 from Hina (radius 1.8): the chair is nearer.
    expect(selectFocused([npc, chair], [1, 0, 0], none)?.id).toBe("chair");
    // 2.5 from the chair is outside its radius even though Hina is farther away overall.
    expect(selectFocused([chair, npc], [-0.5, 0, 0.5], none)?.id).toBe("hina");
  });

  it("measures on the floor plane and skips other floors", () => {
    expect(selectFocused([chair], [2, 1.5, 1], none)?.id).toBe("chair");
    expect(selectFocused([chair], [2, 3, 1], none)).toBeNull();
  });

  it("focuses a locked candidate with the reason instead of acting", () => {
    const focus = selectFocused([door], [-1, 0, 1], none);
    expect(focus).toEqual({ id: "hr-door", kind: "open", label: "Open the HR room", locked: true, reason: "You need an HR card · Visit Reception" });
    expect(selectFocused([door], [-1, 0, 1], all)?.locked).toBe(false);
  });

  it("uses a custom locked reason when given", () => {
    const focus = selectFocused([{ ...door, lockedReason: "Staff only" }], [-1, 0, 0], none);
    expect(focus?.reason).toBe("Staff only");
  });

  it("passes the requirement to the check", () => {
    const seen: string[] = [];
    selectFocused([door], [-1, 0, 0], (requirement) => {
      seen.push(requirement);
      return true;
    });
    expect(seen).toEqual(["card:HR"]);
  });
});

describe("requirementReason", () => {
  it("names the card, and falls back to Locked", () => {
    expect(requirementReason("card:Finance")).toBe("You need a Finance card · Visit Reception");
    expect(requirementReason("card:HR")).toBe("You need an HR card · Visit Reception");
    expect(requirementReason("card:International")).toBe("You need an International card · Visit Reception");
    expect(requirementReason("card:*")).toBe("You need an access card · Visit Reception");
    expect(requirementReason("quest:rooftop")).toBe("Locked");
  });
});

describe("meetsRequirement", () => {
  it("checks one card, any card, and nothing else", () => {
    expect(meetsRequirement(["HR"], "card:HR")).toBe(true);
    expect(meetsRequirement(["IT"], "card:HR")).toBe(false);
    expect(meetsRequirement(["IT"], "card:*")).toBe(true);
    expect(meetsRequirement([], "card:*")).toBe(false);
    expect(meetsRequirement(["HR"], "unlock:rooftop")).toBe(false);
    expect(meetsRequirement(["HR"], "unlock:rooftop", ["rooftop"])).toBe(true);
    expect(meetsRequirement(["HR"], "unlock:rooftop", ["other"])).toBe(false);
  });
});

describe("sameFocus", () => {
  it("compares by id, lock state, label and reason", () => {
    const a = selectFocused([door], [-1, 0, 0], none);
    expect(sameFocus(a, selectFocused([door], [-1, 0, 0.5], none))).toBe(true);
    expect(sameFocus(a, selectFocused([door], [-1, 0, 0], all))).toBe(false);
    expect(sameFocus(null, null)).toBe(true);
    expect(sameFocus(a, null)).toBe(false);
  });
});
