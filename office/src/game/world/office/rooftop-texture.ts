import { fit, INK, type Painter } from "../city/signs";

/**
 * The rooftop's "Wall of fame" plaque (phase O9 › Rooftop): the player's achievements, three
 * columns of titles with their unlock dates, locked ones as faint dashes. 1664 × 704 matches the
 * plaque's 5.2 × 2.2 m face.
 */
export const FAME = { width: 1664, height: 704 };

export type FameEntry = { title: string; unlocked: boolean; date: string };

export function famePainter(orgName: string, entries: FameEntry[]): Painter {
  return (context, fonts, { width, height }) => {
    context.fillStyle = INK.paper;
    context.fillRect(0, 0, width, height);
    context.fillStyle = INK.green;
    context.fillRect(0, 0, width, 22);

    context.textBaseline = "alphabetic";
    context.fillStyle = INK.ink;
    context.font = fonts.serif(84, 600);
    context.fillText("Wall of fame", 72, 136);
    const done = entries.filter((entry) => entry.unlocked).length;
    context.fillStyle = INK.muted;
    context.font = fonts.sans(34, 500);
    const subtitle = `${orgName} · ${done} of ${entries.length} achievements`;
    fit(context, subtitle, (size) => fonts.sans(size, 500), 34, width - 144);
    context.fillText(subtitle, 72, 196);

    const columns = 3;
    const rows = Math.ceil(entries.length / columns);
    const gutter = 40;
    const columnWidth = (width - 144 - gutter * (columns - 1)) / columns;
    const top = 262;
    const rowHeight = Math.min(104, (height - top - 48) / rows);
    entries.forEach((entry, index) => {
      // Fill down each column, so the quest achievements read in order.
      const column = Math.floor(index / rows);
      const row = index % rows;
      const x = 72 + column * (columnWidth + gutter);
      const y = top + row * rowHeight;
      if (entry.unlocked) {
        context.fillStyle = INK.highlighter;
        context.fillRect(x, y - 30, 14, 14);
        context.fillStyle = INK.green;
        context.fillRect(x + 20, y - 30, 14, 14);
        context.fillStyle = INK.ink;
        fit(context, entry.title, (size) => fonts.serif(size, 600), 44, columnWidth - 56);
        context.fillText(entry.title, x + 52, y);
        context.fillStyle = INK.muted;
        context.font = fonts.sans(26, 400);
        context.fillText(entry.date, x + 52, y + 34);
      } else {
        context.fillStyle = "#c9cfc8";
        context.fillRect(x, y - 20, 34, 6);
        context.fillStyle = "#a6aea9";
        context.font = fonts.sans(34, 400);
        context.fillText("—", x + 52, y - 8);
      }
    });
  };
}
