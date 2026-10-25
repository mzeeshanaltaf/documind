"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { expertFor, firstName } from "@/content/personas";
import { audio } from "@/game/audio/audio";
import { drawMatch, pointMessage } from "@/game/games/table-tennis/draw";
import {
  CPU_LEVELS,
  createMatch,
  type Difficulty,
  type Match,
  type MatchEvent,
  stepMatch,
  TABLE,
  tableTennisScore,
  unprojectY,
  VIEW,
  WIN_POINTS,
} from "@/game/games/table-tennis/model";
import { SAMPLE_CITY } from "@/game/world/city/sample";
import { useOfficeDepartments } from "@/game/world/office/use-floorplan";
import { useGame } from "@/game/store/game-store";
import { cn } from "@/lib/utils";
import { GameResult } from "./game-result";
import { useAnimationFrame } from "./use-animation-frame";

/**
 * Desk Table Tennis (phase O8): a match to seven points against a colleague from the office, at
 * Easy, Medium or Hard. The paddle follows the mouse or a finger across the table, or ←/→ (A/D).
 * The ball model is the custom one in `model.ts`; the colleague reacts later and errs more the
 * faster the rally gets.
 */
const KEY_SPEED = 2.4; // metres per second the keyboard moves the paddle

export default function TableTennisGame({ onQuit }: { onQuit: () => void }) {
  const office = useGame((s) => s.office);
  const departments = useOfficeDepartments();
  const [difficulty, setDifficulty] = useState<Difficulty>(2);
  const [phase, setPhase] = useState<"setup" | "playing" | "done">("setup");
  const [opponent, setOpponent] = useState("Your colleague");
  const [runId, setRunId] = useState(0);
  const [final, setFinal] = useState<Match | null>(null);

  function begin() {
    audio.play("ui-open", { volume: 0.4 });
    // A colleague from one of the office's departments, a different one each match.
    const department = departments[Math.floor(Math.random() * departments.length)];
    const persona = department ? expertFor(office?.org.slug ?? "", office?.place ?? SAMPLE_CITY, department) : null;
    setOpponent(persona ? firstName(persona) : "Your colleague");
    setFinal(null);
    setRunId((id) => id + 1);
    setPhase("playing");
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-2 sm:p-4">
      {phase === "setup" && (
        <div className="flex max-w-lg flex-col items-center gap-4 text-center">
          <p className="font-heading text-2xl font-semibold">A quick match at the desk</p>
          <p className="text-sm text-muted-foreground">
            First to {WIN_POINTS} points. Slide your paddle across the table with the mouse or your finger, or use <Kbd>←</Kbd> <Kbd>→</Kbd>. Hit the ball with the edge
            of the paddle to send it the other way, and move as you hit to put spin on it.
          </p>
          <div role="radiogroup" aria-label="Difficulty" className="flex gap-2">
            {([1, 2, 3] as const).map((level) => (
              <button
                key={level}
                type="button"
                role="radio"
                aria-checked={difficulty === level}
                onClick={() => setDifficulty(level)}
                className={cn(
                  "h-9 rounded-md px-4 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                  difficulty === level ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-accent",
                )}
              >
                {CPU_LEVELS[level].label}
              </button>
            ))}
          </div>
          <Button size="lg" autoFocus onClick={begin}>
            Serve
          </Button>
        </div>
      )}

      {phase !== "setup" && (
        <Court
          key={runId}
          difficulty={difficulty}
          opponent={opponent}
          running={phase === "playing"}
          onEnd={(match) => {
            setFinal(match);
            setPhase("done");
          }}
        />
      )}

      {phase === "done" && final && (
        <div className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-background/70 p-3 backdrop-blur-[2px]">
          <GameResult
            outcome={{
              game: "table_tennis",
              score: tableTennisScore(final.score.player, final.score.player >= WIN_POINTS, final.difficulty),
              details: { won: final.score.player >= WIN_POINTS, pointsFor: final.score.player, pointsAgainst: final.score.cpu, difficulty: final.difficulty },
            }}
            heading={final.score.player >= WIN_POINTS ? `You beat ${opponent}, ${final.score.player}–${final.score.cpu}` : `${opponent} wins, ${final.score.cpu}–${final.score.player}`}
            onAgain={begin}
            onQuit={onQuit}
          >
            <p className="text-sm text-muted-foreground">
              10 points for each point you won{final.score.player >= WIN_POINTS ? `, plus ${20 * final.difficulty} for winning on ${CPU_LEVELS[final.difficulty].label}` : ""}.
            </p>
          </GameResult>
        </div>
      )}
    </div>
  );
}

type Controls = { targetY: number; key: -1 | 0 | 1 };

function Court({ difficulty, opponent, running, onEnd }: { difficulty: Difficulty; opponent: string; running: boolean; onEnd: (match: Match) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const court = useRef<HTMLDivElement>(null);
  const match = useRef<Match | null>(null);
  const controls = useRef<Controls>({ targetY: TABLE.width / 2, key: 0 });
  const [status, setStatus] = useState("");

  useEffect(() => {
    match.current = createMatch((Math.random() * 2 ** 32) >>> 0, difficulty);
    controls.current = { targetY: TABLE.width / 2, key: 0 };
  }, [difficulty]);

  const paint = useCallback(() => {
    const element = canvas.current;
    const current = match.current;
    const context = element?.getContext("2d");
    if (!element || !current || !context) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    if (element.width !== VIEW.width * ratio) {
      element.width = VIEW.width * ratio;
      element.height = VIEW.height * ratio;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawMatch(context, current, opponent);
  }, [opponent]);

  const handle = useCallback(
    (events: MatchEvent[], current: Match) => {
      for (const event of events) {
        if (event.type === "hit" || event.type === "serve") audio.play("ui-click", { volume: 0.3, rate: 1.5 });
        else if (event.type === "bounce") audio.play("ui-click", { volume: 0.18, rate: 0.9 });
        else if (event.type === "net") audio.play("ui-deny", { volume: 0.2, rate: 1.4 });
        else if (event.type === "point") {
          audio.play(event.winner === "player" ? "success" : "ui-deny", { volume: 0.35 });
          setStatus(`${pointMessage(current, opponent)}. You ${current.score.player}, ${opponent} ${current.score.cpu}.`);
        }
      }
    },
    [opponent],
  );

  useAnimationFrame((dt) => {
    const current = match.current;
    if (!current || !running) return;
    const c = controls.current;
    if (c.key !== 0) c.targetY = Math.min(TABLE.width + 0.12, Math.max(-0.12, c.targetY + c.key * KEY_SPEED * dt));
    const events = stepMatch(current, { targetY: c.targetY }, dt);
    handle(events, current);
    // Read by the browser tests: the phase and the score.
    if (court.current) {
      court.current.dataset.phase = current.phase;
      court.current.dataset.score = `${current.score.player}-${current.score.cpu}`;
    }
    paint();
    if (current.phase === "done") onEnd(current);
  }, running);

  useEffect(() => {
    if (!running) paint();
  }, [running, paint]);

  // Keys: ←/→ (or A/D) slide the paddle.
  useEffect(() => {
    if (!running) return;
    const onDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code === "ArrowLeft" || event.code === "KeyA") {
        controls.current.key = -1;
        event.preventDefault();
      } else if (event.code === "ArrowRight" || event.code === "KeyD") {
        controls.current.key = 1;
        event.preventDefault();
      }
    };
    const onUp = (event: KeyboardEvent) => {
      const c = controls.current;
      if ((event.code === "ArrowLeft" || event.code === "KeyA") && c.key === -1) c.key = 0;
      if ((event.code === "ArrowRight" || event.code === "KeyD") && c.key === 1) c.key = 0;
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [running]);

  // Pointer: the paddle goes where the mouse or finger is across the table.
  const follow = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!running) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const sx = ((event.clientX - rect.left) / rect.width) * VIEW.width;
    controls.current.targetY = Math.min(TABLE.width + 0.12, Math.max(-0.12, unprojectY(sx)));
    controls.current.key = 0;
  };

  return (
    <div ref={court} className="flex w-full max-w-[min(100%,calc((94dvh-8rem)*16/9))] flex-col gap-2" data-table-tennis-court="">
      <canvas
        ref={canvas}
        width={VIEW.width}
        height={VIEW.height}
        role="img"
        aria-label={`Table tennis against ${opponent}. Move the paddle across the table to return the ball.`}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          follow(event);
        }}
        onPointerMove={follow}
        className={cn("aspect-video w-full touch-none rounded-xl bg-card ring-1 ring-foreground/10", running && "cursor-none")}
      />
      <p className="sr-only" aria-live="polite">
        {status}
      </p>
      <p className="text-center text-xs text-muted-foreground max-sm:hidden">
        Move the mouse (or your finger) across the table, or <Kbd>←</Kbd> <Kbd>→</Kbd>.
      </p>
    </div>
  );
}
