import { create } from "zustand";

/**
 * Shared between the location list (DOM) and the globe (canvas): which location is hovered or
 * focused, which one was chosen, and the clock the local times show. The canvas reads it with
 * `getState()` per frame; the list and the labels subscribe.
 */
export type HoverSource = "list" | "globe";

/** How long the camera flies to a chosen pin before the page navigates. Lives here, not in the
 * rig, so the page can read it without pulling three into its bundle. */
export const FLY_MS = 1000;

export type GlobeState = {
  hovered: string | null;
  /** A list focus turns the globe to the pin; a pointer on the globe doesn't (it would run away). */
  hoverSource: HoverSource | null;
  /** The chosen location: the camera flies to it (or the page fades), then the page navigates. */
  selected: string | null;
  /** Epoch ms, refreshed every 30 s. */
  now: number;
  /** The globe's canvas is up; without it (no WebGL, still loading) a choice just fades. */
  ready: boolean;
  hover: (id: string | null, source: HoverSource) => void;
  select: (id: string) => void;
  tick: (now: number) => void;
  setReady: (ready: boolean) => void;
  reset: (now: number) => void;
};

export const useGlobe = create<GlobeState>()((set, get) => ({
  hovered: null,
  hoverSource: null,
  selected: null,
  now: 0,
  ready: false,
  hover: (hovered, source) => {
    if (get().selected) return;
    // Leaving one target only clears the hover it set, so a pointer leaving a pin doesn't drop
    // a list focus that came later.
    if (hovered === null && get().hoverSource !== source) return;
    set({ hovered, hoverSource: hovered ? source : null });
  },
  select: (selected) => set({ selected, hovered: selected, hoverSource: "list" }),
  tick: (now) => set({ now }),
  setReady: (ready) => set({ ready }),
  reset: (now) => set({ hovered: null, hoverSource: null, selected: null, now }),
}));
