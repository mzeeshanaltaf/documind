import { fit, INK, type Painter } from "../city/signs";

/**
 * The interior's painted signs, in DocuMind's families: door plates, room notices, the
 * directory board and the lobby clock. Canvas textures (see city/signs.ts).
 */

/** A door plate (512 × 160): an accent stripe, the room in serif, one line in sans. */
export const PLATE = { width: 512, height: 160 };
export function platePainter(title: string, line: string, accent: string): Painter {
  return (context, fonts, { width, height }) => {
    context.fillStyle = INK.paper;
    context.fillRect(0, 0, width, height);
    context.fillStyle = accent;
    context.fillRect(0, 0, 14, height);
    context.fillStyle = INK.ink;
    fit(context, title, (s) => fonts.serif(s), 64, width - 64);
    context.fillText(title, 40, 78);
    context.fillStyle = INK.muted;
    fit(context, line, (s) => fonts.sans(s), 28, width - 64);
    context.fillText(line, 40, 126);
  };
}

/** A notice on a room's wall (768 × 480): title, then up to four lines. */
export const NOTICE = { width: 768, height: 480 };
export function noticePainter(title: string, lines: string[], accent: string): Painter {
  return (context, fonts, { width, height }) => {
    context.fillStyle = INK.paper;
    context.fillRect(0, 0, width, height);
    context.fillStyle = accent;
    context.fillRect(0, 0, width, 16);
    context.fillStyle = INK.ink;
    fit(context, title, (s) => fonts.serif(s), 76, width - 96);
    context.fillText(title, 48, 120);
    context.fillStyle = INK.muted;
    context.font = fonts.sans(32);
    lines.slice(0, 4).forEach((line, index) => {
      fit(context, line, (s) => fonts.sans(s), 32, width - 96);
      context.fillText(line, 48, 200 + index * 56);
    });
  };
}

/** The lobby's directory board (768 × 1024): every room, in floor-plan order. */
export const DIRECTORY = { width: 768, height: 1024 };
export function directoryPainter(orgName: string, rows: { name: string; where: string }[]): Painter {
  return (context, fonts, { width, height }) => {
    context.fillStyle = INK.green;
    context.fillRect(0, 0, width, height);
    context.fillStyle = INK.paper;
    fit(context, orgName, (s) => fonts.serif(s), 64, width - 96);
    context.fillText(orgName, 48, 104);
    context.globalAlpha = 0.75;
    context.font = fonts.sans(30, 500);
    context.fillText("Directory", 48, 152);
    context.globalAlpha = 0.35;
    context.fillRect(48, 180, width - 96, 2);
    context.globalAlpha = 1;
    const rowHeight = Math.min(84, (height - 240) / Math.max(1, rows.length));
    rows.forEach((row, index) => {
      const y = 240 + index * rowHeight + rowHeight * 0.55;
      context.fillStyle = INK.paper;
      context.font = fonts.sans(Math.min(40, rowHeight * 0.5), 500);
      context.fillText(row.name, 48, y);
      context.globalAlpha = 0.7;
      context.font = fonts.sans(Math.min(30, rowHeight * 0.38));
      const whereWidth = context.measureText(row.where).width;
      context.fillText(row.where, width - 48 - whereWidth, y);
      context.globalAlpha = 1;
    });
  };
}

/** The lobby clock (512 × 192): the office's local time, and the city. */
export const CLOCK = { width: 512, height: 192 };
export function clockPainter(time: string, city: string): Painter {
  return (context, fonts, { width, height }) => {
    context.fillStyle = INK.ink;
    context.fillRect(0, 0, width, height);
    context.fillStyle = INK.paper;
    context.font = fonts.sans(96, 500);
    const timeWidth = context.measureText(time).width;
    context.fillText(time, (width - timeWidth) / 2, 118);
    context.globalAlpha = 0.7;
    context.font = fonts.sans(30, 500);
    const label = city.toUpperCase().split("").join(" ");
    const labelWidth = context.measureText(label).width;
    context.fillText(label, (width - labelWidth) / 2, 166);
    context.globalAlpha = 1;
  };
}

/** The lobby's feature wall lettering beside the mark (1024 × 256): "DocuMind" in serif. */
export const WORDMARK = { width: 1024, height: 256 };
export const wordmarkPainter: Painter = (context, fonts, { height }) => {
  context.fillStyle = INK.green;
  context.font = fonts.serif(150);
  context.fillText("DocuMind", 8, height / 2 + 52);
};
