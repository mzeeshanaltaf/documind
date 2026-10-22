import { useEffect, useMemo } from "react";
import { CanvasTexture, SRGBColorSpace } from "three";
import { cssFont } from "../kit";

/**
 * Signage painted on canvases in DocuMind's own families (no font download, unlike troika
 * text), repainted once the web fonts have loaded. Colours are the design tokens' sRGB
 * equivalents (DESIGN.md › Email).
 */
export const INK = {
  paper: "#f9fcfa",
  ink: "#121916",
  muted: "#616a66",
  green: "#1a5d48",
  highlighter: "#f6e5a4",
  highlightInk: "#3a3523",
};

export type Fonts = { serif: (size: number, weight?: number) => string; sans: (size: number, weight?: number) => string };
export type Painter = (context: CanvasRenderingContext2D, fonts: Fonts, size: { width: number; height: number }) => void;

function createTexture(width: number, height: number, paint: Painter): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  const context = canvas.getContext("2d");
  if (!context) return texture;
  const serifFamily = cssFont("--font-source-serif", "Georgia, serif");
  const sansFamily = cssFont("--font-instrument-sans", "system-ui, sans-serif");
  const fonts: Fonts = {
    serif: (size, weight = 600) => `${weight} ${size}px ${serifFamily}`,
    sans: (size, weight = 400) => `${weight} ${size}px ${sansFamily}`,
  };
  const draw = () => {
    context.clearRect(0, 0, width, height);
    paint(context, fonts, { width, height });
    texture.needsUpdate = true;
  };
  draw();
  void Promise.all([document.fonts.load(fonts.serif(40)), document.fonts.load(fonts.sans(40)), document.fonts.load(fonts.sans(40, 500))]).then(
    draw,
    () => undefined,
  );
  return texture;
}

/** A canvas texture for the component's lifetime; `key` lists what the painter reads. */
export function useCanvasTexture(width: number, height: number, paint: Painter, key: string) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for the painter's inputs.
  const texture = useMemo(() => createTexture(width, height, paint), [width, height, key]);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

/** The largest font size (down from `size`) at which `text` fits in `width`. */
export function fit(context: CanvasRenderingContext2D, text: string, font: (size: number) => string, size: number, width: number) {
  let current = size;
  context.font = font(current);
  while (current > 12 && context.measureText(text).width > width) {
    current -= 4;
    context.font = font(current);
  }
  return current;
}

/** The office sign: "Simtora Technologies · Lahore", paper on the accent band (2048 × 180). */
export const OFFICE_SIGN = { width: 2048, height: 180 };
export function officeSignPainter(org: string, city: string, band: string): Painter {
  return (context, fonts, { width, height }) => {
    context.fillStyle = band;
    context.fillRect(0, 0, width, height);
    const separator = "  ·  ";
    const serifSize = fit(context, `${org}${separator}${city}`, (s) => fonts.serif(s), 104, width - 160);
    const sansSize = Math.round(serifSize * 0.78);
    context.font = fonts.serif(serifSize);
    const orgWidth = context.measureText(org).width;
    context.font = fonts.sans(sansSize, 500);
    const restWidth = context.measureText(`${separator}${city}`).width;
    const x = (width - orgWidth - restWidth) / 2;
    const baseline = height / 2 + serifSize * 0.34;
    context.fillStyle = INK.paper;
    context.font = fonts.serif(serifSize);
    context.fillText(org, x, baseline);
    context.globalAlpha = 0.82;
    context.font = fonts.sans(sansSize, 500);
    context.fillText(`${separator}${city}`, x + orgWidth, baseline);
    context.globalAlpha = 1;
  };
}

// The DocuMind mark (components/brand/logo.tsx), on a 32-unit grid.
const PAGE = "M10.5 7.5h7.4l4.6 4.6v11.4a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V8.5a1 1 0 0 1 1-1Z";
const FOLD = "M17.9 7.5v3.6a1 1 0 0 0 1 1h3.6";

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  context.beginPath();
  context.roundRect(x, y, w, h, r);
  context.fill();
}

/** DocuMind's mark for the lobby glass (256 × 256, transparent round the tile). */
export const logoPainter: Painter = (context, _fonts, { width }) => {
  const unit = width / 32;
  context.save();
  context.scale(unit, unit);
  context.fillStyle = INK.green;
  roundRect(context, 0, 0, 32, 32, 8);
  context.fillStyle = INK.paper;
  context.fill(new Path2D(PAGE));
  context.fillStyle = "rgba(26, 93, 72, 0.28)";
  context.fill(new Path2D(FOLD));
  context.fillStyle = "rgba(26, 93, 72, 0.45)";
  roundRect(context, 11.75, 12.6, 5, 1.5, 0.75);
  roundRect(context, 11.75, 20.4, 6.5, 1.5, 0.75);
  context.fillStyle = INK.highlighter;
  roundRect(context, 10.75, 15.6, 10.5, 3.2, 0.8);
  context.fillStyle = "rgba(58, 53, 35, 0.85)";
  roundRect(context, 11.75, 16.45, 8.5, 1.5, 0.75);
  context.restore();
};

/** A Global Hub kiosk's panel: the city, its role and country (512 × 320). */
export function kioskPainter(name: string, detail: string, accent: string): Painter {
  return (context, fonts, { width, height }) => {
    context.fillStyle = INK.paper;
    context.fillRect(0, 0, width, height);
    context.fillStyle = accent;
    context.fillRect(0, 0, width, 18);
    context.fillStyle = INK.ink;
    fit(context, name, (s) => fonts.serif(s), 84, width - 64);
    context.fillText(name, 32, height / 2 + 10);
    context.fillStyle = INK.muted;
    fit(context, detail, (s) => fonts.sans(s), 34, width - 64);
    context.fillText(detail, 32, height / 2 + 68);
  };
}

/** The generic kit's monument: the city's name carved in a stone slab (1024 × 320). */
export function monumentPainter(city: string, country: string): Painter {
  return (context, fonts, { width, height }) => {
    context.fillStyle = "#d8d3c6";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#3b3a34";
    const size = fit(context, city, (s) => fonts.serif(s), 190, width - 120);
    const cityWidth = context.measureText(city).width;
    context.fillText(city, (width - cityWidth) / 2, height / 2 + size * 0.28);
    context.font = fonts.sans(40, 500);
    context.fillStyle = "#6b685e";
    const label = country.toUpperCase().split("").join(" ");
    const labelWidth = context.measureText(label).width;
    context.fillText(label, (width - labelWidth) / 2, height - 36);
  };
}
