import { sansFamily } from "../font";
import {
  BELT,
  BIN_TOP,
  BIN_WIDTH,
  BINS,
  currentItem,
  DURATION_S,
  FIELD,
  flightPoint,
  HAND,
  type ItemKind,
  ITEM_LABEL,
  type RoundState,
  speedForPower,
  trajectory,
  beltSpeed,
  comboMultiplier,
} from "./logic";

/**
 * Sort & Toss on a 2D canvas (phase O8): the conveyor, the item in hand, the arc preview, the
 * bins and the balls in flight. Pure drawing, no state of its own: the component owns the loop.
 * Colours are DocuMind's palette (paper, ink green) plus one hue per bin.
 */
export const COLORS = {
  wall: "#eef1ec",
  floor: "#d8ddd3",
  ink: "#121916",
  muted: "#616a66",
  green: "#1a5d48",
  belt: "#2c3430",
  beltStripe: "#4a5750",
  paper: "#f9fcfa",
  bins: { paper: "#3d6fb0", recycling: "#2f7d4f", general: "#5e6a64" },
  good: "#1a5d48",
  bad: "#b7473a",
};

export type Aim = { angle: number; power: number; visible: boolean };
export type Popup = { x: number; y: number; text: string; age: number; tone: "good" | "bad" | "neutral" };

export function drawItem(ctx: CanvasRenderingContext2D, kind: ItemKind, x: number, y: number, size = 40, rotation = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  const s = size / 40;
  ctx.scale(s, s);
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLORS.ink;
  ctx.lineJoin = "round";
  switch (kind) {
    case "paper":
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(-13, -17);
      ctx.lineTo(7, -17);
      ctx.lineTo(15, -9);
      ctx.lineTo(15, 17);
      ctx.lineTo(-13, 17);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(7, -17);
      ctx.lineTo(7, -9);
      ctx.lineTo(15, -9);
      ctx.stroke();
      ctx.strokeStyle = "#9aa39f";
      for (let line = -3; line <= 11; line += 7) {
        ctx.beginPath();
        ctx.moveTo(-8, line);
        ctx.lineTo(10, line);
        ctx.stroke();
      }
      break;
    case "can":
      ctx.fillStyle = "#c4cbc7";
      ctx.beginPath();
      ctx.roundRect(-11, -16, 22, 34, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#d0463a";
      ctx.fillRect(-11, -4, 22, 12);
      ctx.strokeRect(-11, -4, 22, 12);
      ctx.fillStyle = "#e9ece8";
      ctx.beginPath();
      ctx.ellipse(0, -16, 11, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    case "cup":
      ctx.fillStyle = "#f2efe6";
      ctx.beginPath();
      ctx.moveTo(-14, -12);
      ctx.lineTo(14, -12);
      ctx.lineTo(10, 18);
      ctx.lineTo(-10, 18);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#7a5a3e";
      ctx.fillRect(-12.5, -3, 25, 11);
      ctx.strokeRect(-12.5, -3, 25, 11);
      ctx.fillStyle = "#3b4842";
      ctx.beginPath();
      ctx.roundRect(-16, -18, 32, 7, 3);
      ctx.fill();
      ctx.stroke();
      break;
    case "battery":
      ctx.fillStyle = "#2f7d4f";
      ctx.beginPath();
      ctx.roundRect(-9, -15, 18, 33, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#e0a23a";
      ctx.fillRect(-9, -6, 18, 12);
      ctx.strokeRect(-9, -6, 18, 12);
      ctx.fillStyle = "#c4cbc7";
      ctx.fillRect(-4, -20, 8, 5);
      ctx.strokeRect(-4, -20, 8, 5);
      break;
    case "peel":
      ctx.fillStyle = "#e8c23c";
      ctx.beginPath();
      ctx.moveTo(-16, 8);
      ctx.bezierCurveTo(-14, -14, 8, -18, 16, -10);
      ctx.bezierCurveTo(6, -6, 2, 4, -4, 12);
      ctx.bezierCurveTo(-8, 14, -13, 13, -16, 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#7a5a3e";
      ctx.beginPath();
      ctx.arc(15, -10, 2.5, 0, Math.PI * 2);
      ctx.fill();
      break;
  }
  ctx.restore();
}

function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = "left", weight = 600) {
  ctx.font = `${weight} ${size}px ${sansFamily()}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(value, x, y);
}

export function drawSortToss(ctx: CanvasRenderingContext2D, state: RoundState, aim: Aim, popups: readonly Popup[]) {
  const { width, height } = FIELD;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = COLORS.wall;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = COLORS.floor;
  ctx.fillRect(0, 478, width, height - 478);

  // The belt, its stripes moving with its speed, and the drop at the end.
  ctx.fillStyle = COLORS.belt;
  ctx.beginPath();
  ctx.roundRect(BELT.x0 - 30, BELT.y, BELT.x1 - BELT.x0 + 60, 22, 11);
  ctx.fill();
  ctx.strokeStyle = COLORS.beltStripe;
  ctx.lineWidth = 3;
  const travelled = (state.time * (70 + beltSpeed(state.time))) / 2;
  for (let x = BELT.x0 - 24 + (travelled % 28); x < BELT.x1 + 24; x += 28) {
    ctx.beginPath();
    ctx.moveTo(x, BELT.y + 4);
    ctx.lineTo(x, BELT.y + 18);
    ctx.stroke();
  }
  ctx.fillStyle = "#1c2421";
  ctx.beginPath();
  ctx.moveTo(BELT.x1 + 24, BELT.y + 8);
  ctx.lineTo(BELT.x1 + 70, BELT.y + 70);
  ctx.lineTo(BELT.x1 + 24, BELT.y + 70);
  ctx.closePath();
  ctx.fill();
  text(ctx, "Falls off here", BELT.x1 + 12, BELT.y + 92, 14, COLORS.muted, "left", 500);

  // Items on the belt; the one in hand is ringed.
  state.items.forEach((item, index) => {
    drawItem(ctx, item.kind, item.x, BELT.y - 22, 38);
    if (index === 0) {
      ctx.strokeStyle = COLORS.green;
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.roundRect(item.x - 28, BELT.y - 52, 56, 60, 10);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  });

  // The bins.
  for (const bin of BINS) {
    const x0 = bin.x - BIN_WIDTH / 2;
    ctx.fillStyle = COLORS.bins[bin.id];
    ctx.beginPath();
    ctx.roundRect(x0, BIN_TOP, BIN_WIDTH, 478 - BIN_TOP + 22, [4, 4, 10, 10]);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(x0 + 8, BIN_TOP, BIN_WIDTH - 16, 8);
    ctx.fillStyle = COLORS.paper;
    ctx.beginPath();
    ctx.roundRect(x0 + 12, BIN_TOP + 22, BIN_WIDTH - 24, 28, 6);
    ctx.fill();
    text(ctx, bin.label, bin.x, BIN_TOP + 42, 17, COLORS.ink, "center", 700);
  }

  // The thrower and the item in hand.
  ctx.fillStyle = COLORS.green;
  ctx.beginPath();
  ctx.arc(HAND.x - 34, HAND.y + 16, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(HAND.x - 56, HAND.y + 28, 44, 52);
  ctx.fillStyle = "#e2b48f";
  ctx.beginPath();
  ctx.arc(HAND.x - 34, HAND.y - 14, 15, 0, Math.PI * 2);
  ctx.fill();
  const held = currentItem(state);
  if (held && !state.done) {
    drawItem(ctx, held.kind, HAND.x, HAND.y, 38);
    text(ctx, ITEM_LABEL[held.kind], HAND.x, HAND.y - 34, 16, COLORS.ink, "center", 600);
  } else if (!state.done) {
    text(ctx, "Waiting for the next item", HAND.x - 10, HAND.y - 30, 14, COLORS.muted, "center", 500);
  }

  // The aiming preview and the power meter.
  if (aim.visible && held && !state.done) {
    const dots = trajectory(aim.angle, speedForPower(aim.power), 22);
    dots.forEach((dot, index) => {
      ctx.fillStyle = `rgba(26, 93, 72, ${0.75 - (index / dots.length) * 0.5})`;
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, 4, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = "rgba(18,25,22,0.15)";
    ctx.fillRect(HAND.x - 40, HAND.y + 52, 80, 8);
    ctx.fillStyle = COLORS.green;
    ctx.fillRect(HAND.x - 40, HAND.y + 52, 80 * aim.power, 8);
  }

  // Balls in the air.
  for (const flight of state.flights) {
    const point = flightPoint(flight.angle, flight.speed, flight.elapsed);
    drawItem(ctx, flight.kind, point.x, point.y, 34, flight.elapsed * 9);
  }

  // The HUD: score, time and the combo.
  text(ctx, `Score ${state.score}`, 28, 44, 26, COLORS.ink, "left", 700);
  const left = Math.max(0, Math.ceil(DURATION_S - state.time));
  text(ctx, `${left}`, width / 2, 52, 44, left <= 10 ? COLORS.bad : COLORS.ink, "center", 700);
  text(ctx, "seconds", width / 2, 72, 13, COLORS.muted, "center", 500);
  if (state.combo >= 2) text(ctx, `×${comboMultiplier(state.combo)}  ${state.combo} in a row`, width - 28, 44, 24, COLORS.green, "right", 700);

  // Floating results.
  for (const popup of popups) {
    ctx.globalAlpha = Math.max(0, 1 - popup.age / 1.1);
    text(ctx, popup.text, popup.x, popup.y - popup.age * 40, 26, popup.tone === "good" ? COLORS.good : popup.tone === "bad" ? COLORS.bad : COLORS.muted, "center", 800);
    ctx.globalAlpha = 1;
  }
}
