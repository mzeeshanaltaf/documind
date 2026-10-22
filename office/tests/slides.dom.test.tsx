import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DOCUMIND_DECK } from "@/content/documind-deck";
import { SIMTORA_DECK } from "@/content/orgs/simtora-deck";
import { SlideView } from "@/game/world/office/presentation/deck";
import { programmeOf } from "@/game/world/office/presentation/slides";

// Phase O7 › Slide engine: every slide renders as the screen's frame and as the readable page.

afterEach(cleanup);

const programme = programmeOf([DOCUMIND_DECK, SIMTORA_DECK]);
const LAHORE = { id: "lahore", name: "Lahore", hub: false };

describe("SlideView", () => {
  it.each(programme.map((entry) => [`${entry.deck.id}:${entry.slide.id}`, entry] as const))("renders %s in both variants", (_, entry) => {
    const page = render(<SlideView entry={entry} variant="page" place={LAHORE} />);
    expect(page.getByRole("heading", { level: 2 }).textContent).toBe(entry.slide.title);
    expect(page.container.textContent).toContain(`${String(entry.index + 1).padStart(2, "0")} / ${String(entry.total).padStart(2, "0")}`);
    page.unmount();
    const screen = render(<SlideView entry={entry} variant="screen" place={LAHORE} />);
    // The screen's copy is decorative (aria-hidden by its host): no headings there.
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.container.textContent).toContain(entry.slide.title);
  });

  it("marks the current office on the map", () => {
    const map = programme.find((entry) => entry.slide.kind === "map")!;
    const { container } = render(<SlideView entry={map} variant="page" place={LAHORE} />);
    expect(container.textContent).toContain("You are here: Lahore");
    cleanup();
    const hub = render(<SlideView entry={map} variant="page" place={{ id: "worldwide", name: "Global Hub", hub: true }} />);
    expect(hub.container.textContent).toContain("You are in the Global Hub");
  });

  it("gives the readable video controls and its on-screen-text captions", () => {
    const video = programme.find((entry) => entry.slide.kind === "video")!;
    const { container } = render(<SlideView entry={video} variant="page" place={LAHORE} />);
    const element = container.querySelector("video")!;
    expect(element.hasAttribute("controls")).toBe(true);
    expect(container.querySelector("track")?.getAttribute("src")).toBe("/video/documind-explainer.vtt");
    expect(container.textContent).toContain("has no sound");
  });

  it("links the last DocuMind slide to DocuMind in a new tab", () => {
    const last = programme.find((entry) => entry.slide.linkToDocuMind)!;
    const { getByRole } = render(<SlideView entry={last} variant="page" place={LAHORE} />);
    const link = getByRole("link", { name: /open documind/i });
    expect(link.getAttribute("target")).toBe("_blank");
  });
});
