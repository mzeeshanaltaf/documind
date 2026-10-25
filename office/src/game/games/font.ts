/**
 * DocuMind's UI font for the games' canvases (phase O8). A canvas can't use `var(--font-…)` in its
 * `font`, so the family is read from the CSS variable once and kept (the font is loaded by then:
 * the DOM around the canvas already uses it).
 */
let family: string | null = null;

export function sansFamily(): string {
  if (family === null) {
    const value = getComputedStyle(document.documentElement).getPropertyValue("--font-instrument-sans").trim();
    family = value ? `${value}, system-ui, sans-serif` : "system-ui, sans-serif";
  }
  return family;
}
