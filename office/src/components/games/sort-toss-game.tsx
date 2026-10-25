"use client";

import { BookOpenIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { audio } from "@/game/audio/audio";
import { type Aim, drawSortToss, type Popup } from "@/game/games/sort-toss/draw";
import {
  aimFromDrag,
  clampAngle,
  currentItem,
  DEFAULT_ANGLE,
  DURATION_S,
  FIELD,
  ITEM_LABEL,
  type RoundState,
  type SortEvent,
  startRound,
  stepRound,
  throwItem,
} from "@/game/games/sort-toss/logic";
import { emit } from "@/game/quests/bus";
import { useGame } from "@/game/store/game-store";
import { cn } from "@/lib/utils";
import { GameResult } from "./game-result";
import { useAnimationFrame } from "./use-animation-frame";

/**
 * Sort & Toss (phase O8): sort office waste into Paper, Recycling and General for 60 seconds.
 * Throw the item in hand by dragging back from it and letting go (mouse or touch), or with the
 * arrow keys to aim and Space held for power. The rules follow the Facilities manual (SIM-FAC-001),
 * cited on the results card.
 */
const KEY_TURN_RATE = 0.9; // radians per second
const CHARGE_TIME = 1.1; // seconds from the lightest to the hardest throw
const MIN_CHARGE = 0.2;
const MIN_DRAG = 14; // logical px; a shorter drag is a tap, not a throw
const FACILITIES = { code: "SIM-FAC-001", page: 68, batteriesPage: 56 };

export default function SortTossGame({ onQuit }: { onQuit: () => void }) {
  const [phase, setPhase] = useState<"intro" | "playing" | "done">("intro");
  const [final, setFinal] = useState<RoundState | null>(null);
  const [runId, setRunId] = useState(0);

  const begin = () => {
    audio.play("ui-open", { volume: 0.4 });
    setFinal(null);
    setRunId((id) => id + 1);
    setPhase("playing");
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-2 sm:p-4">
      {phase !== "intro" && (
        <Field
          key={runId}
          running={phase === "playing"}
          onEnd={(state) => {
            setFinal(state);
            setPhase("done");
          }}
        />
      )}
      {phase === "intro" && <Intro onStart={begin} />}
      {phase === "done" && final && (
        <div className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-background/70 p-3 backdrop-blur-[2px]">
          <GameResult
            outcome={{ game: "sort_toss", score: final.score, details: { correct: final.correct, wrong: final.wrong, maxCombo: final.maxCombo } }}
            heading={final.score > 0 ? `${final.correct} sorted right` : "Round over"}
            onAgain={begin}
            onQuit={onQuit}
          >
            <Breakdown state={final} />
          </GameResult>
        </div>
      )}
    </div>
  );
}

function Intro({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex max-w-lg flex-col items-center gap-4 text-center">
      <p className="font-heading text-2xl font-semibold">Sort it before it falls off</p>
      <p className="text-sm text-muted-foreground">
        Items ride the conveyor. Throw the one in hand into Paper, Recycling or General. A right bin scores, a wrong bin costs a point, and the belt
        speeds up for {DURATION_S} seconds. Keep a streak for a bigger multiplier.
      </p>
      <ul className="grid gap-1.5 text-left text-sm">
        <li className="flex items-center gap-2">
          <span className="w-24 shrink-0 font-medium">Mouse or touch</span> drag back from the item and let go: further back throws harder
        </li>
        <li className="flex items-center gap-2">
          <span className="w-24 shrink-0 font-medium">Keyboard</span>
          <span>
            <Kbd>←</Kbd> <Kbd>→</Kbd> aim, hold <Kbd>Space</Kbd> for power, release to throw
          </span>
        </li>
      </ul>
      <Button size="lg" autoFocus onClick={onStart}>
        Start
      </Button>
    </div>
  );
}

function Breakdown({ state }: { state: RoundState }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <dl className="grid grid-cols-3 gap-2 text-center">
        {[
          ["Right", state.correct],
          ["Wrong bin", state.wrong],
          ["Best streak", state.maxCombo],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg bg-muted/60 px-2 py-2">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="font-heading text-xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-muted-foreground">{state.missed} fell off the belt or missed every bin.</p>
      <SourceNote />
    </div>
  );
}

/** Where the bin rules come from: the Facilities manual, with a link to the page when it's open to the player. */
function SourceNote() {
  const doc = useGame((s) => s.office?.documents.find((d) => d.doc_code === FACILITIES.code && d.indexed_at !== null));
  function open(page: number) {
    if (!doc) return;
    audio.play("ui-open", { volume: 0.4 });
    useGame.getState().openViewer({
      documentId: doc.id,
      title: doc.title,
      docCode: doc.doc_code,
      page,
      pageEnd: page,
      highlightText: null,
      npc: null,
      department: doc.department,
    });
    emit({ type: "citation_opened", doc_code: FACILITIES.code, department: doc.department });
  }
  return (
    <p className="rounded-lg bg-accent/60 px-3 py-2 text-accent-foreground">
      <span className="font-medium">Why these bins?</span> Offices keep recycling, compost (where available) and landfill bins (
      <span className="font-mono text-xs">
        {FACILITIES.code} p. {FACILITIES.page}
      </span>
      ), and batteries go in marked collection containers, never general trash (
      <span className="font-mono text-xs">p. {FACILITIES.batteriesPage}</span>).
      {doc &&
        [FACILITIES.page, FACILITIES.batteriesPage].map((page) => (
          <Button key={page} size="xs" variant="outline" className="ml-2" onClick={() => open(page)} data-show-source={page}>
            <BookOpenIcon data-icon="inline-start" aria-hidden />
            View p. {page}
          </Button>
        ))}
    </p>
  );
}

type Input = {
  angle: number;
  charge: number;
  charging: boolean;
  /** A pointer drag in progress: where it began and where it is, in field px. */
  drag: { id: number; from: { x: number; y: number }; to: { x: number; y: number } } | null;
  turn: -1 | 0 | 1;
};

/** The field: one canvas, a frame loop, and the inputs. Owns the round until it ends. */
function Field({ running, onEnd }: { running: boolean; onEnd: (state: RoundState) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const state = useRef<RoundState | null>(null);
  const input = useRef<Input>({ angle: DEFAULT_ANGLE, charge: MIN_CHARGE, charging: false, drag: null, turn: 0 });
  const popups = useRef<Popup[]>([]);
  const [status, setStatus] = useState("");

  const handleEvents = useCallback((events: SortEvent[]) => {
    for (const event of events) {
      if (event.type === "landed" && surface.current) surface.current.dataset.landed = String(Number(surface.current.dataset.landed ?? 0) + 1);
      if (event.type === "thrown") {
        audio.play("ui-click", { volume: 0.35, rate: 1.4 });
      } else if (event.type === "landed") {
        const x = event.bin ? FIELD.width * 0.72 : FIELD.width * 0.6;
        if (event.outcome === "correct") {
          audio.play("success", { volume: 0.3, rate: 1 + Math.min(0.5, event.multiplier * 0.1) });
          popups.current.push({ x, y: 400, text: `+${event.points}`, age: 0, tone: "good" });
          setStatus(`${ITEM_LABEL[event.kind]} in the right bin, ${event.points} points.`);
        } else if (event.outcome === "wrong") {
          audio.play("ui-deny", { volume: 0.4 });
          popups.current.push({ x, y: 400, text: "Wrong bin −1", age: 0, tone: "bad" });
          setStatus(`${ITEM_LABEL[event.kind]} in the wrong bin.`);
        } else {
          popups.current.push({ x, y: 460, text: "Miss", age: 0, tone: "neutral" });
          setStatus(`${ITEM_LABEL[event.kind]} missed the bins.`);
        }
      } else if (event.type === "dropped") {
        audio.play("ui-deny", { volume: 0.25, rate: 0.8 });
        popups.current.push({ x: 600, y: 230, text: `${ITEM_LABEL[event.kind]} dropped`, age: 0, tone: "neutral" });
      }
    }
  }, []);

  // The round, from a fresh seed, for this mount.
  useEffect(() => {
    state.current = startRound((Math.random() * 2 ** 32) >>> 0);
    input.current = { angle: DEFAULT_ANGLE, charge: MIN_CHARGE, charging: false, drag: null, turn: 0 };
    popups.current = [];
    surface.current?.focus();
  }, []);

  // Draws at the device's pixel ratio (capped), the field coordinates unchanged.
  const paint = useCallback(() => {
    const element = canvas.current;
    const round = state.current;
    const context = element?.getContext("2d");
    if (!element || !round || !context) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    if (element.width !== FIELD.width * ratio) {
      element.width = FIELD.width * ratio;
      element.height = FIELD.height * ratio;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const i = input.current;
    const aim: Aim = i.drag
      ? { ...aimFromDrag(i.drag.from.x - i.drag.to.x, i.drag.to.y - i.drag.from.y), visible: true }
      : { angle: i.angle, power: i.charging ? i.charge : MIN_CHARGE, visible: true };
    drawSortToss(context, round, aim, popups.current);
  }, []);

  useAnimationFrame((dt) => {
    const round = state.current;
    if (!round || !running || round.done) return;
    const i = input.current;
    if (i.turn !== 0) i.angle = clampAngle(i.angle + i.turn * KEY_TURN_RATE * dt);
    if (i.charging) i.charge = Math.min(1, i.charge + (1 - MIN_CHARGE) * (dt / CHARGE_TIME));
    const stepped = stepRound(round, dt);
    state.current = stepped.state;
    handleEvents(stepped.events);
    popups.current = popups.current.map((popup) => ({ ...popup, age: popup.age + dt })).filter((popup) => popup.age < 1.1);
    // Read by the browser tests (and handy in the inspector): the item in hand and the score.
    if (surface.current) {
      surface.current.dataset.item = currentItem(stepped.state)?.kind ?? "";
      surface.current.dataset.score = String(stepped.state.score);
    }
    paint();
    if (stepped.state.done) onEnd(stepped.state);
  }, running);

  // Paints once for the non-running states (a finished round stays on screen behind the card).
  useEffect(() => {
    if (!running) paint();
  }, [running, paint]);

  const doThrow = useCallback(
    (angle: number, power: number) => {
      const round = state.current;
      if (!round || round.done) return;
      const thrown = throwItem(round, angle, power);
      state.current = thrown.state;
      handleEvents(thrown.events);
    },
    [handleEvents],
  );

  // Keyboard: ←/→ aim, Space charges and throws on release. The dialog ignores the world's keys.
  useEffect(() => {
    if (!running) return;
    const onDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const i = input.current;
      if (event.code === "ArrowLeft" || event.code === "KeyA") {
        i.turn = -1;
        event.preventDefault();
      } else if (event.code === "ArrowRight" || event.code === "KeyD") {
        i.turn = 1;
        event.preventDefault();
      } else if (event.code === "Space") {
        // Not on a button: Space there would also click it.
        event.preventDefault();
        if (!event.repeat && !i.charging) {
          i.charging = true;
          i.charge = MIN_CHARGE;
        }
      }
    };
    const onUp = (event: KeyboardEvent) => {
      const i = input.current;
      if (event.code === "ArrowLeft" || event.code === "KeyA") {
        if (i.turn === -1) i.turn = 0;
      } else if (event.code === "ArrowRight" || event.code === "KeyD") {
        if (i.turn === 1) i.turn = 0;
      } else if (event.code === "Space") {
        event.preventDefault();
        if (i.charging) {
          i.charging = false;
          doThrow(i.angle, i.charge);
          i.charge = MIN_CHARGE;
        }
      }
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [running, doThrow]);

  // Pointer: drag back from anywhere, let go to throw.
  const toField = (event: React.PointerEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * FIELD.width, y: ((event.clientY - rect.top) / rect.height) * FIELD.height };
  };
  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!running || event.button > 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const at = toField(event);
    // The drag starts at the thrower, so the pull is measured from the item, wherever you press.
    input.current.drag = { id: event.pointerId, from: { x: at.x, y: at.y }, to: at };
  };
  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = input.current.drag;
    if (drag && drag.id === event.pointerId) drag.to = toField(event);
  };
  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = input.current.drag;
    if (!drag || drag.id !== event.pointerId) return;
    input.current.drag = null;
    const dx = drag.from.x - drag.to.x;
    const dy = drag.to.y - drag.from.y;
    if (Math.hypot(dx, dy) < MIN_DRAG) return;
    const { angle, power } = aimFromDrag(dx, dy);
    input.current.angle = angle;
    doThrow(angle, Math.max(power, 0.15));
  };
  const cancelDrag = () => {
    input.current.drag = null;
  };

  return (
    <div ref={surface} tabIndex={-1} className="flex w-full max-w-[min(100%,calc((94dvh-8rem)*16/9))] flex-col gap-2 outline-none" data-sort-toss-field="">
      <canvas
        ref={canvas}
        width={FIELD.width}
        height={FIELD.height}
        role="img"
        aria-label="Sort and Toss. Items ride a conveyor towards the end; throw each into the Paper, Recycling or General bin."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={cancelDrag}
        className={cn("aspect-video w-full touch-none rounded-xl bg-card ring-1 ring-foreground/10", running ? "cursor-crosshair" : "")}
      />
      <p className="sr-only" aria-live="polite">
        {status}
      </p>
      <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground max-sm:hidden">
        <span>
          Drag back from the item and let go, or <Kbd>←</Kbd> <Kbd>→</Kbd> to aim and hold <Kbd>Space</Kbd>
        </span>
        <span>Paper → blue · Recycling (cans, batteries) → green · General (cups, peels) → grey</span>
      </p>
    </div>
  );
}

