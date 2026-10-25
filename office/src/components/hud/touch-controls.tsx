"use client";

import { HandIcon, MenuIcon, SmileIcon } from "lucide-react";
import { useRef } from "react";
import { interactWithFocus } from "@/game/interact/interact";
import { closeEmoteWheel, openEmoteWheel } from "@/game/player/emote-actions";
import { NO_MOVE } from "@/game/input/bindings";
import { joystickVector } from "@/game/input/joystick";
import { useGame } from "@/game/store/game-store";

const RADIUS = 48;

/**
 * Touch controls, shown on coarse pointers only (CSS): a joystick on the left writing the same
 * move vector as the keyboard, and Use / Menu buttons on the right.
 */
export function TouchControls() {
  const knob = useRef<HTMLSpanElement>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const hasFocus = useGame((s) => s.focus !== null && !s.focus.locked);
  const wheelOpen = useGame((s) => s.emoteWheel.open);

  function moveKnob(dx: number, dy: number) {
    const distance = Math.hypot(dx, dy);
    const scale = distance > RADIUS ? RADIUS / distance : 1;
    if (knob.current) knob.current.style.transform = `translate(${dx * scale}px, ${dy * scale}px)`;
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    drag.current = { id: event.pointerId, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    event.currentTarget.setPointerCapture(event.pointerId);
    onPointerMove(event);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const origin = drag.current;
    if (!origin || origin.id !== event.pointerId) return;
    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;
    moveKnob(dx, dy);
    const { move, run } = joystickVector(dx, dy, RADIUS);
    useGame.getState().setTouchInput(move, run);
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    moveKnob(0, 0);
    useGame.getState().setTouchInput(NO_MOVE, false);
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-10 hidden items-end justify-between p-[max(1rem,env(safe-area-inset-bottom))] pointer-coarse:flex">
      <div
        aria-hidden
        data-touch="joystick"
        className="pointer-events-auto relative flex size-32 touch-none items-center justify-center rounded-full bg-background/70 ring-1 ring-foreground/15"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span ref={knob} className="size-14 rounded-full bg-background shadow-md ring-1 ring-foreground/15" />
      </div>
      <div className="pointer-events-auto mb-2 flex flex-col items-center gap-3">
        <button
          type="button"
          aria-label="Menu"
          onClick={() => useGame.getState().openModal({ type: "menu" })}
          className="flex size-11 items-center justify-center rounded-full bg-background/90 shadow-sm ring-1 ring-foreground/15 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <MenuIcon className="size-5" />
        </button>
        <button
          type="button"
          aria-label="Emotes"
          aria-expanded={wheelOpen}
          onClick={() => (wheelOpen ? closeEmoteWheel() : openEmoteWheel())}
          className="flex size-11 items-center justify-center rounded-full bg-background/90 shadow-sm ring-1 ring-foreground/15 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <SmileIcon className="size-5" />
        </button>
        <button
          type="button"
          aria-label="Use"
          disabled={!hasFocus}
          onClick={() => interactWithFocus()}
          className="flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:bg-background/80 disabled:text-muted-foreground disabled:ring-1 disabled:ring-foreground/15"
        >
          <HandIcon className="size-6" />
        </button>
      </div>
    </div>
  );
}
