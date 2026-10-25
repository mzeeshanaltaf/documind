import { GAME_IDS, GAME_NAMES } from "@/game/games/types";
import type { Leaderboards } from "@/lib/leaderboard";
import { mixHex } from "../../city/lighting";
import { fit, INK, type Painter } from "../../city/signs";
import { cssFont } from "../../kit";

/**
 * The leaderboard wall's screen (phase O8 › Scores & leaderboard): three columns, one per game,
 * each the top five (best score per player) of the org, all time. Repainted when a game ends.
 */
export const BOARD = { width: 1536, height: 404 };
export const WALL_ROWS = 5;

const mono = (size: number, weight = 400) => `${weight} ${size}px ${cssFont("--font-geist-mono", "ui-monospace, monospace")}`;

export function boardPainter(boards: Leaderboards | null, orgName: string, failed = false): Painter {
  return (context, fonts, { width, height }) => {
    context.fillStyle = "#151c19";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#9fd8c3";
    context.fillRect(0, 0, width, 8);

    context.fillStyle = mixHex(INK.paper, "#151c19", 0.5);
    context.font = mono(22, 500);
    context.textBaseline = "alphabetic";
    context.fillText(`LEADERBOARDS · ${orgName.toUpperCase()} · ALL TIME`, 40, 44);

    const gutter = 32;
    const left = 40;
    const columnWidth = (width - left * 2 - gutter * 2) / 3;
    GAME_IDS.forEach((game, column) => {
      const x = left + column * (columnWidth + gutter);
      context.fillStyle = INK.paper;
      fit(context, GAME_NAMES[game], (s) => fonts.serif(s), 44, columnWidth);
      context.fillText(GAME_NAMES[game], x, 100);
      context.fillStyle = mixHex(INK.paper, "#151c19", 0.7);
      context.fillRect(x, 116, columnWidth, 2);

      const entries = boards?.[game] ?? [];
      if (entries.length === 0) {
        context.fillStyle = mixHex(INK.paper, "#151c19", 0.5);
        context.font = fonts.sans(28);
        context.fillText(boards ? "No scores yet" : failed ? "Couldn't load" : "Loading…", x, 170);
        if (boards) context.fillText("Be the first.", x, 210);
        return;
      }
      entries.slice(0, WALL_ROWS).forEach((entry, index) => {
        const y = 164 + index * 56;
        context.fillStyle = entry.mine ? "#9fd8c3" : mixHex(INK.paper, "#151c19", index === 0 ? 0 : 0.12);
        context.font = mono(26, 500);
        context.fillText(String(entry.rank), x, y);
        context.font = fonts.sans(30, index === 0 || entry.mine ? 600 : 400);
        const score = String(entry.score);
        context.font = mono(30, 500);
        const scoreWidth = context.measureText(score).width;
        context.fillText(score, x + columnWidth - scoreWidth, y);
        context.font = fonts.sans(30, index === 0 || entry.mine ? 600 : 400);
        let name = entry.name;
        while (name.length > 3 && context.measureText(name).width > columnWidth - scoreWidth - 90) name = `${name.slice(0, -2)}…`;
        context.fillText(name, x + 52, y);
      });
    });
  };
}
