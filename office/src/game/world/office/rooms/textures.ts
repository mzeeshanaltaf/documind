import { mixHex } from "../../city/lighting";
import { mulberry32, pick, range } from "../../city/random";
import { fit, INK, type Painter } from "../../city/signs";
import { cssFont } from "../../kit";
import type { Rect } from "../floorplan";

/**
 * The department rooms' painted panels (phase O6 › Rooms): canvas textures in DocuMind's
 * families, like the lobby's signage. Sizes keep each panel's aspect ratio (decor.ts).
 */
const mono = (size: number, weight = 400) => `${weight} ${size}px ${cssFont("--font-geist-mono", "ui-monospace, monospace")}`;

const SKINS = ["#f3d5c0", "#e2b48f", "#c68a5e", "#a46a43", "#7a4a2c", "#4b2e1e"];
const HAIRS = ["#1d1a19", "#2f241d", "#6b3f22", "#8f3b1f", "#d1a65a", "#a7a7a2"];
const TOPS = ["#2f6f5e", "#2c3e63", "#9c4535", "#c99a2e", "#5e3a5c", "#3d6fb0", "#c26a3f"];

/** Splits `text` into at most `max` lines that fit `width` in the current font. */
function wrap(context: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (context.measureText(next).width <= width || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > max) {
    const kept = lines.slice(0, max);
    kept[max - 1] = `${kept[max - 1].replace(/\s+\S*$/, "")}…`;
    return kept;
  }
  return lines;
}

// --- the wall screen ----------------------------------------------------------------------------

export const SCREEN = { width: 1024, height: 576 };
export type ScreenContent =
  | { kind: "room"; department: string; expert: string; blurb: string; accent: string }
  | { kind: "document"; docCode: string | null; title: string; page: string; accent: string };

export function screenPainter(content: ScreenContent): Painter {
  return (context, fonts, { width, height }) => {
    context.fillStyle = "#151c19";
    context.fillRect(0, 0, width, height);
    context.fillStyle = content.accent;
    context.fillRect(0, 0, width, 12);
    const left = 64;
    if (content.kind === "room") {
      context.fillStyle = INK.paper;
      fit(context, content.department, (s) => fonts.serif(s), 120, width - left * 2);
      context.fillText(content.department, left, 220);
      context.fillStyle = mixHex(INK.paper, "#151c19", 0.3);
      context.font = fonts.sans(38);
      wrap(context, content.blurb, width - left * 2, 2).forEach((line, index) => context.fillText(line, left, 300 + index * 52));
      context.fillStyle = mixHex(content.accent, INK.paper, 0.45);
      context.font = fonts.sans(34, 500);
      context.fillText(`Ask ${content.expert}`, left, height - 64);
      context.fillStyle = mixHex(INK.paper, "#151c19", 0.55);
      context.font = fonts.serif(30);
      const mark = "DocuMind";
      context.fillText(mark, width - left - context.measureText(mark).width, height - 64);
      return;
    }
    // A cited document is open in the viewer.
    context.fillStyle = mixHex(INK.paper, "#151c19", 0.4);
    context.font = fonts.sans(28, 500);
    context.fillText("OPEN IN THE VIEWER", left, 96);
    if (content.docCode) {
      context.fillStyle = mixHex(content.accent, INK.paper, 0.5);
      context.font = mono(40);
      context.fillText(content.docCode, left, 168);
    }
    context.fillStyle = INK.paper;
    context.font = fonts.serif(64);
    const lines = wrap(context, content.title, width - left * 2, 2);
    lines.forEach((line, index) => context.fillText(line, left, 256 + index * 76));
    const y = 256 + lines.length * 76 + 40;
    // The page, on a highlighter stroke: the cited passage.
    context.font = fonts.sans(56, 500);
    const pageWidth = context.measureText(content.page).width;
    context.fillStyle = INK.highlighter;
    context.fillRect(left - 12, y - 52, pageWidth + 24, 70);
    context.fillStyle = INK.highlightInk;
    context.fillText(content.page, left, y);
    context.fillStyle = mixHex(INK.paper, "#151c19", 0.4);
    context.font = fonts.sans(30);
    context.fillText("Cited passage", left + pageWidth + 40, y - 6);
  };
}

// --- HR -----------------------------------------------------------------------------------------

/** A gallery wall of framed portraits (1024 × 384, for a 3.2 × 1.2 m panel). */
export const PEOPLE = { width: 1024, height: 384 };
export const peoplePainter: Painter = (context, _fonts, { width, height }) => {
  context.clearRect(0, 0, width, height);
  const random = mulberry32(31);
  const frames = [
    [40, 30, 150, 190],
    [220, 70, 120, 150],
    [370, 20, 170, 210],
    [570, 60, 130, 160],
    [730, 25, 150, 190],
    [910, 80, 90, 120],
    [90, 245, 130, 120],
    [260, 250, 110, 110],
    [400, 255, 150, 115],
    [590, 245, 120, 125],
    [750, 240, 160, 130],
  ] as const;
  for (const [x, y, w, h] of frames) {
    context.fillStyle = pick(random, ["#8a6646", "#2c3430", "#c9b48a", "#d9cfbd"]);
    context.fillRect(x, y, w, h);
    const m = Math.min(w, h) * 0.09;
    context.fillStyle = mixHex(pick(random, TOPS), "#f9fcfa", 0.65);
    context.fillRect(x + m, y + m, w - m * 2, h - m * 2);
    // Shoulders, head, hair.
    const cx = x + w / 2;
    const unit = Math.min(w, h) * 0.5;
    context.fillStyle = pick(random, TOPS);
    context.beginPath();
    context.ellipse(cx, y + h - m, unit * 0.62, unit * 0.42, 0, Math.PI, 0);
    context.fill();
    const headY = y + h - m - unit * 0.62;
    context.fillStyle = pick(random, SKINS);
    context.beginPath();
    context.arc(cx, headY, unit * 0.27, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = pick(random, HAIRS);
    context.beginPath();
    context.arc(cx, headY - unit * 0.04, unit * 0.29, Math.PI * 1.05, Math.PI * 1.95);
    context.fill();
    if (random() < 0.4) context.fillRect(cx - unit * 0.29, headY - unit * 0.06, unit * 0.1, unit * 0.32);
  }
};

/** The leave calendar (640 × 470): this month's grid with leave blocks. */
export const CALENDAR = { width: 640, height: 470 };
export function calendarPainter(month: string, accent: string): Painter {
  return (context, fonts, { width, height }) => {
    context.fillStyle = INK.paper;
    context.fillRect(0, 0, width, height);
    context.fillStyle = INK.ink;
    context.font = fonts.serif(46);
    context.fillText(`Leave · ${month}`, 32, 64);
    const top = 96;
    const cols = 7;
    const rows = 5;
    const cell = (width - 64) / cols;
    const rowHeight = (height - top - 24) / rows;
    context.font = fonts.sans(20, 500);
    ["M", "T", "W", "T", "F", "S", "S"].forEach((day, index) => {
      context.fillStyle = index > 4 ? INK.muted : INK.ink;
      context.fillText(day, 32 + index * cell + 8, top + 4);
    });
    context.strokeStyle = "#dce1de";
    context.lineWidth = 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) context.strokeRect(32 + c * cell, top + 14 + r * rowHeight, cell, rowHeight);
    }
    const random = mulberry32(month.length * 13);
    const colours = [accent, "#3d6fb0", "#2f7d4f", "#c08a24"];
    for (let k = 0; k < 7; k++) {
      const r = Math.floor(random() * rows);
      const start = Math.floor(random() * 5);
      const span = 1 + Math.floor(random() * (5 - start));
      context.fillStyle = pick(random, colours);
      const lane = (k % 3) * 14;
      context.fillRect(32 + start * cell + 6, top + 14 + r * rowHeight + 30 + lane, span * cell - 12, 10);
    }
  };
}

// --- IT ------------------------------------------------------------------------------------------

export const POSTER = { width: 512, height: 696 };
export const itPosterPainter: Painter = (context, fonts, { width, height }) => {
  context.fillStyle = "#2c3e63";
  context.fillRect(0, 0, width, height);
  context.fillStyle = INK.paper;
  context.font = fonts.serif(66);
  ["Have you", "tried turning", "it off and", "on again?"].forEach((line, index) => {
    fit(context, line, (s) => fonts.serif(s), 66, width - 80);
    context.fillText(line, 40, 120 + index * 78);
  });
  // A power symbol.
  context.strokeStyle = "#e7c74a";
  context.lineWidth = 16;
  context.lineCap = "round";
  context.beginPath();
  context.arc(width / 2, 520, 62, -Math.PI * 0.32, Math.PI * 1.32);
  context.stroke();
  context.beginPath();
  context.moveTo(width / 2, 440);
  context.lineTo(width / 2, 512);
  context.stroke();
  context.fillStyle = mixHex(INK.paper, "#2c3e63", 0.35);
  context.font = fonts.sans(26, 500);
  context.fillText("IT Service Desk", 40, height - 40);
};

// --- Finance -------------------------------------------------------------------------------------

export const CHART = { width: 768, height: 427 };
export function chartPainter(kind: "bars" | "line"): Painter {
  return (context, fonts, { width, height }) => {
    context.fillStyle = "#151c19";
    context.fillRect(0, 0, width, height);
    context.fillStyle = mixHex(INK.paper, "#151c19", 0.3);
    context.font = fonts.sans(26, 500);
    context.fillText(kind === "bars" ? "Spend by quarter" : "Expenses this year", 36, 52);
    const left = 48;
    const bottom = height - 48;
    const top = 90;
    context.strokeStyle = "#33403b";
    context.lineWidth = 2;
    for (let k = 0; k <= 3; k++) {
      const y = bottom - ((bottom - top) * k) / 3;
      context.beginPath();
      context.moveTo(left, y);
      context.lineTo(width - 36, y);
      context.stroke();
    }
    const random = mulberry32(kind === "bars" ? 3 : 5);
    if (kind === "bars") {
      const count = 8;
      const slot = (width - 36 - left) / count;
      for (let k = 0; k < count; k++) {
        const value = range(random, 0.35, 0.95);
        context.fillStyle = k % 2 ? "#5fae7f" : "#3d8f62";
        const h = (bottom - top) * value;
        context.fillRect(left + k * slot + slot * 0.2, bottom - h, slot * 0.6, h);
      }
      return;
    }
    const points = Array.from({ length: 12 }, (_, k) => [left + (k * (width - 36 - left)) / 11, bottom - (bottom - top) * range(random, 0.25 + k * 0.03, 0.55 + k * 0.03)]);
    context.fillStyle = "rgba(95, 174, 127, 0.18)";
    context.beginPath();
    context.moveTo(points[0][0], bottom);
    for (const [x, y] of points) context.lineTo(x, y);
    context.lineTo(points.at(-1)![0], bottom);
    context.fill();
    context.strokeStyle = "#7cc596";
    context.lineWidth = 6;
    context.lineJoin = "round";
    context.beginPath();
    points.forEach(([x, y], k) => (k ? context.lineTo(x, y) : context.moveTo(x, y)));
    context.stroke();
  };
}

// --- Facilities ----------------------------------------------------------------------------------

/** The office's own floor plan, white on blueprint blue (640 × 468). */
export const BLUEPRINT = { width: 640, height: 468 };
export function blueprintPainter(rooms: { rect: Rect; name: string }[], city: string): Painter {
  return (context, fonts, { width, height }) => {
    context.fillStyle = "#24527a";
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "rgba(255,255,255,0.08)";
    context.lineWidth = 1;
    for (let x = 0; x < width; x += 20) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
    for (let y = 0; y < height; y += 20) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
    context.fillStyle = "#e6eef5";
    context.font = fonts.sans(26, 500);
    context.fillText(`Floor plan · ${city}`, 28, 44);
    if (rooms.length === 0) return;
    const x0 = Math.min(...rooms.map((r) => r.rect.x - r.rect.w / 2));
    const x1 = Math.max(...rooms.map((r) => r.rect.x + r.rect.w / 2));
    const z0 = Math.min(...rooms.map((r) => r.rect.z - r.rect.d / 2));
    const z1 = Math.max(...rooms.map((r) => r.rect.z + r.rect.d / 2));
    const scale = Math.min((width - 56) / (x1 - x0), (height - 90) / (z1 - z0));
    const ox = (width - (x1 - x0) * scale) / 2;
    const oy = 64 + (height - 80 - (z1 - z0) * scale) / 2;
    context.strokeStyle = "#e6eef5";
    context.lineWidth = 2.5;
    for (const room of rooms) {
      const rx = ox + (room.rect.x - room.rect.w / 2 - x0) * scale;
      const ry = oy + (room.rect.z - room.rect.d / 2 - z0) * scale;
      context.strokeRect(rx, ry, room.rect.w * scale, room.rect.d * scale);
    }
  };
}

export const RECYCLING = { width: 896, height: 202 };
export const recyclingPainter: Painter = (context, fonts, { width, height }) => {
  const bins = [
    ["Paper", "#3d6fb0"],
    ["Plastic", "#c08a24"],
    ["Glass", "#4d7d4f"],
  ] as const;
  const slot = width / bins.length;
  bins.forEach(([label, color], index) => {
    context.fillStyle = color;
    context.fillRect(index * slot + 10, 10, slot - 20, height - 20);
    context.fillStyle = INK.paper;
    context.font = fonts.sans(64, 500);
    const w = context.measureText(label).width;
    context.fillText(label, index * slot + (slot - w) / 2, height / 2 + 22);
  });
};

// --- Compliance ----------------------------------------------------------------------------------

export function speakUpPainter(expert: string): Painter {
  return (context, fonts, { width, height }) => {
    context.fillStyle = INK.paper;
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#6f4a8e";
    context.fillRect(0, 0, width, 210);
    context.fillStyle = INK.paper;
    context.font = fonts.serif(104);
    context.fillText("Speak up.", 40, 150);
    context.fillStyle = INK.ink;
    context.font = fonts.sans(36);
    ["If something isn't right,", "tell us. You can stay", "anonymous."].forEach((line, index) => context.fillText(line, 40, 300 + index * 50));
    context.fillStyle = "#6f4a8e";
    context.font = fonts.sans(34, 500);
    context.fillText(`Ask ${expert} how.`, 40, height - 60);
  };
}

// --- International -------------------------------------------------------------------------------

export const MAP = { width: 1408, height: 704 };
export type MapPin = { name: string; lat: number; lon: number; hq: boolean };
export type Mask = { width: number; height: number; data: Uint8Array };

/** An equirectangular world map from the land mask, with a pin and label per office. */
export function mapPainter(mask: Mask | null, pins: MapPin[]): Painter {
  return (context, fonts, { width, height }) => {
    context.fillStyle = "#dfe8e6";
    context.fillRect(0, 0, width, height);
    if (mask && mask.width > 1) {
      const land = document.createElement("canvas");
      land.width = mask.width;
      land.height = mask.height;
      const landContext = land.getContext("2d");
      if (landContext) {
        const image = landContext.createImageData(mask.width, mask.height);
        for (let i = 0; i < mask.data.length; i++) {
          const isLand = mask.data[i] > 127;
          image.data[i * 4] = 0xa9;
          image.data[i * 4 + 1] = 0xb8;
          image.data[i * 4 + 2] = 0xa2;
          image.data[i * 4 + 3] = isLand ? 255 : 0;
        }
        landContext.putImageData(image, 0, 0);
        context.drawImage(land, 0, 0, width, height);
      }
    }
    for (const pin of pins) {
      const x = ((pin.lon + 180) / 360) * width;
      const y = ((90 - pin.lat) / 180) * height;
      context.fillStyle = pin.hq ? INK.green : "#b23a2e";
      context.strokeStyle = INK.paper;
      context.lineWidth = 4;
      context.beginPath();
      context.arc(x, y, pin.hq ? 13 : 10, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.font = fonts.sans(28, 500);
      const labelWidth = context.measureText(pin.name).width;
      const lx = Math.min(width - labelWidth - 12, x + 16);
      context.fillStyle = "rgba(249, 252, 250, 0.85)";
      context.fillRect(lx - 6, y - 26, labelWidth + 12, 36);
      context.fillStyle = INK.ink;
      context.fillText(pin.name, lx, y + 2);
    }
  };
}

/** City names and UTC offsets under the clocks (512 px per clock). */
export const CLOCK_LABEL = { perClock: 512, height: 171 };
export function clockLabelsPainter(labels: { city: string; offset: string }[]): Painter {
  return (context, fonts, { width, height }) => {
    context.clearRect(0, 0, width, height);
    const slot = width / Math.max(1, labels.length);
    labels.forEach(({ city, offset }, index) => {
      context.fillStyle = INK.ink;
      fit(context, city, (s) => fonts.sans(s, 500), 64, slot - 24);
      const w = context.measureText(city).width;
      context.fillText(city, index * slot + (slot - w) / 2, 76);
      context.fillStyle = INK.muted;
      context.font = mono(44);
      const ow = context.measureText(offset).width;
      context.fillText(offset, index * slot + (slot - ow) / 2, 142);
    });
  };
}

// --- Generic -------------------------------------------------------------------------------------

export const WHITEBOARD = { width: 832, height: 384 };
export function whiteboardPainter(department: string): Painter {
  return (context, fonts, { width, height }) => {
    context.fillStyle = "#f6f7f4";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#2c5d9a";
    fit(context, department, (s) => fonts.serif(s), 64, width - 80);
    context.fillText(department, 40, 84);
    context.strokeStyle = "#2c5d9a";
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(40, 100);
    context.lineTo(Math.min(width - 40, 40 + context.measureText(department).width), 104);
    context.stroke();
    context.fillStyle = "#3a3f3c";
    context.font = fonts.sans(30);
    ["Policies and procedures", "Who to ask", "What's new this quarter"].forEach((line, index) => context.fillText(`• ${line}`, 48, 160 + index * 52));
    context.strokeStyle = "#b23a2e";
    context.beginPath();
    context.arc(width - 170, 220, 80, 0, Math.PI * 2);
    context.stroke();
  };
}
