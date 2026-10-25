import { sansFamily } from "../font";
import { BALL_RADIUS, CPU_LEVELS, CPU_PLANE, type Match, NET_X, PLAYER_PLANE, type PointReason, project, TABLE, VIEW, WIN_POINTS } from "./model";

/**
 * Desk Table Tennis on a 2D canvas (phase O8): the table in perspective from behind the player's
 * paddle, the ball with its shadow, both paddles and a scoreboard. Pure drawing.
 */
const COLORS = {
  wall: "#eef1ec",
  floor: "#d8ddd3",
  ink: "#121916",
  muted: "#616a66",
  table: "#2c6e63",
  tableEdge: "#1f4f47",
  line: "#f2f2ee",
  paddlePlayer: "#b7473a",
  paddleCpu: "#243b34",
  green: "#1a5d48",
  paper: "#f9fcfa",
};

const AGAINST_OPPONENT: Record<PointReason, (name: string) => string> = {
  missed: (name) => `${name} couldn't return it`,
  out: (name) => `${name}'s shot missed the table`,
  net: (name) => `${name}'s shot hit the net`,
  "double-bounce": (name) => `${name} let it bounce twice`,
};
const AGAINST_YOU: Record<PointReason, string> = {
  missed: "You couldn't return it",
  out: "Your shot missed the table",
  net: "Your shot hit the net",
  "double-bounce": "It bounced twice on your side",
};

/** The line under the score after a point: who won it and why. */
export function pointMessage(match: Match, opponent: string): string {
  const point = match.lastPoint;
  if (!point) return "";
  return point.winner === "player" ? `Point! ${AGAINST_OPPONENT[point.reason](opponent)}` : `${opponent} scores. ${AGAINST_YOU[point.reason]}`;
}

function paddle(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, scale: number, tilt = 0) {
  const p = project(x, y, 0.12);
  ctx.save();
  ctx.translate(p.sx, p.sy);
  ctx.rotate(tilt);
  ctx.fillStyle = "#7a5a3e";
  ctx.fillRect(-5 * p.scale, 6 * p.scale, 10 * p.scale, 36 * p.scale);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, 0, 36 * p.scale, 30 * p.scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function label(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = "center", weight = 600) {
  ctx.font = `${weight} ${size}px ${sansFamily()}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(value, x, y);
}

export function drawMatch(ctx: CanvasRenderingContext2D, match: Match, opponent: string) {
  const { width, height } = VIEW;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = COLORS.wall;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = COLORS.floor;
  ctx.fillRect(0, VIEW.farY - 20, width, height);

  // The table top.
  const corner = (x: number, y: number) => project(x, y, 0);
  const a = corner(0, 0);
  const b = corner(0, TABLE.width);
  const c = corner(TABLE.length, TABLE.width);
  const d = corner(TABLE.length, 0);
  ctx.fillStyle = COLORS.tableEdge;
  ctx.beginPath();
  ctx.moveTo(a.sx - 6, a.sy);
  ctx.lineTo(b.sx + 6, b.sy);
  ctx.lineTo(b.sx + 6, b.sy + 18);
  ctx.lineTo(a.sx - 6, a.sy + 18);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = COLORS.table;
  ctx.beginPath();
  ctx.moveTo(a.sx, a.sy);
  ctx.lineTo(b.sx, b.sy);
  ctx.lineTo(c.sx, c.sy);
  ctx.lineTo(d.sx, d.sy);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 3;
  ctx.stroke();
  const l0 = corner(0, TABLE.width / 2);
  const l1 = corner(TABLE.length, TABLE.width / 2);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(l0.sx, l0.sy);
  ctx.lineTo(l1.sx, l1.sy);
  ctx.stroke();

  // The CPU's paddle sits behind the table; the net and the ball in front of it.
  paddle(ctx, CPU_PLANE, match.cpu.y, COLORS.paddleCpu, project(CPU_PLANE, 0, 0).scale, Math.PI);

  // The ball's shadow, then the net, then the ball (so it passes in front of the net when it should).
  const ball = match.ball;
  if (ball) {
    const shadow = project(ball.x, ball.y, 0);
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(shadow.sx, shadow.sy, 9 * shadow.scale, 4 * shadow.scale, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const n0 = project(NET_X, -0.08, 0);
  const n1 = project(NET_X, TABLE.width + 0.08, 0);
  const top0 = project(NET_X, -0.08, TABLE.netHeight);
  const top1 = project(NET_X, TABLE.width + 0.08, TABLE.netHeight);
  ctx.fillStyle = "rgba(249,252,250,0.55)";
  ctx.beginPath();
  ctx.moveTo(n0.sx, n0.sy);
  ctx.lineTo(n1.sx, n1.sy);
  ctx.lineTo(top1.sx, top1.sy);
  ctx.lineTo(top0.sx, top0.sy);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = COLORS.paper;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(top0.sx, top0.sy);
  ctx.lineTo(top1.sx, top1.sy);
  ctx.stroke();

  const held = !ball && match.phase === "serve";
  const at = ball ?? (held ? { x: (match.server === "player" ? PLAYER_PLANE : CPU_PLANE) + (match.server === "player" ? 0.02 : -0.02), y: (match.server === "player" ? match.player.y : match.cpu.y), z: 0.28 } : null);
  if (at) {
    const p = project(at.x, at.y, at.z);
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, Math.max(5, (BALL_RADIUS * 520) * p.scale), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // The player's paddle, in front.
  paddle(ctx, PLAYER_PLANE, match.player.y, COLORS.paddlePlayer, project(PLAYER_PLANE, 0, 0).scale);

  // The scoreboard.
  label(ctx, `You  ${match.score.player}`, width / 2 - 40, 44, 30, COLORS.ink, "right", 700);
  label(ctx, ":", width / 2, 42, 30, COLORS.muted, "center", 700);
  label(ctx, `${match.score.cpu}  ${opponent}`, width / 2 + 40, 44, 30, COLORS.ink, "left", 700);
  const level = CPU_LEVELS[match.difficulty];
  label(ctx, `First to ${WIN_POINTS} · ${level.label} · ${match.server === "player" ? "your serve" : `${opponent}'s serve`}`, width / 2, 70, 15, COLORS.muted, "center", 500);

  if (match.phase === "point" || match.phase === "done") {
    ctx.fillStyle = "rgba(249,252,250,0.88)";
    ctx.fillRect(width / 2 - 250, 96, 500, 46);
    label(ctx, pointMessage(match, opponent), width / 2, 127, 20, match.lastPoint?.winner === "player" ? COLORS.green : COLORS.ink, "center", 700);
  } else if (match.phase === "serve" && match.timer > 0.2) {
    label(ctx, match.server === "player" ? "Get ready…" : `${opponent} is serving…`, width / 2, 127, 18, COLORS.muted, "center", 600);
  }
}
