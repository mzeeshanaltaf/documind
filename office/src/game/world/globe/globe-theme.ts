import type { EarthColors } from "./earth-geometry";

/**
 * Globe colours per UI theme. The globe sits on the page background, so it follows light/dark:
 * paper land on a pale green-grey sea by day, the same steps darkened at night. Ink green
 * (DESIGN.md's accent, sRGB as in web's email layout) is kept for what you act on: pins, arcs
 * and the Worldwide ring.
 */
export type GlobeTheme = {
  earth: EarthColors;
  /** The inner sphere that fills the gaps under raised coastlines. */
  seaBase: string;
  pin: string;
  stem: string;
  arc: string;
  ring: string;
  hemisphere: [sky: string, ground: string];
};

export const GLOBE_THEMES: Record<"light" | "dark", GlobeTheme> = {
  light: {
    earth: { land: ["#fbfcfa", "#f5f7f3", "#eff2ed"], sea: ["#9dbbb1", "#99b7ad", "#a1beb4"] },
    seaBase: "#93b1a7",
    pin: "#1a5d48",
    stem: "#3c4a44",
    arc: "#1a5d48",
    ring: "#1a5d48",
    hemisphere: ["#ffffff", "#9fb2aa"],
  },
  dark: {
    earth: { land: ["#6b7d74", "#65776e", "#71827a"], sea: ["#22342e", "#20312b", "#243630"] },
    seaBase: "#1c2c26",
    pin: "#7cc3ac",
    stem: "#a9b8b1",
    arc: "#7cc3ac",
    ring: "#7cc3ac",
    hemisphere: ["#dfe9e4", "#1c2622"],
  },
};
