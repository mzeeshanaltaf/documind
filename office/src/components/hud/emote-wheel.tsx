"use client";

import { CoffeeIcon, HandIcon, MusicIcon, PartyPopperIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Kbd } from "@/components/ui/kbd";
import { audio } from "@/game/audio/audio";
import { closeEmoteWheel, highlightEmote, performEmote } from "@/game/player/emote-actions";
import { EMOTES, type EmoteId } from "@/game/player/emotes";
import { useGame } from "@/game/store/game-store";
import { cn } from "@/lib/utils";

/**
 * The emote wheel (phase O8 › Ambient activities): hold Q, point at a gesture (or press 1 to 3)
 * and let go. On touch the HUD button opens it and a tap picks. Hovering highlights a slot so
 * releasing Q plays it.
 */
const ICONS: Record<EmoteId, typeof HandIcon> = { wave: HandIcon, cheer: PartyPopperIcon, dance: MusicIcon };
/** Slot positions on the arc, in rem from the wheel's centre (left, top, right). */
const SLOTS = [
  { x: -5.2, y: -1.4 },
  { x: 0, y: -4.4 },
  { x: 5.2, y: -1.4 },
] as const;

export function EmoteWheel() {
  const open = useGame((s) => s.emoteWheel.open);
  const highlight = useGame((s) => s.emoteWheel.highlight);
  if (!open) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-20 flex items-center justify-center">
      <div role="group" aria-label="Emotes" data-emote-wheel="" className="pointer-events-auto relative size-0">
        {EMOTES.map((emote, index) => {
          const Icon = ICONS[emote.id];
          const slot = SLOTS[index];
          const active = highlight === index;
          return (
            <button
              key={emote.id}
              type="button"
              onPointerEnter={() => highlightEmote(index)}
              onPointerLeave={() => highlightEmote(null)}
              onFocus={() => highlightEmote(index)}
              onClick={() => {
                audio.play("ui-click", { volume: 0.4 });
                performEmote(emote.id);
              }}
              style={{ transform: `translate(calc(${slot.x}rem - 50%), calc(${slot.y}rem - 50%))` }}
              className={cn(
                "absolute flex size-[4.5rem] flex-col items-center justify-center gap-0.5 rounded-full bg-background/95 text-sm font-medium shadow-md ring-1 ring-foreground/15 outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                active ? "bg-primary text-primary-foreground ring-primary" : "hover:bg-muted",
              )}
            >
              <Icon className="size-5" aria-hidden />
              <span className="leading-none">{emote.label}</span>
              <Kbd className={cn("h-4 min-w-4 text-[0.65rem]", active && "bg-primary-foreground/20 text-primary-foreground")}>{index + 1}</Kbd>
            </button>
          );
        })}
        <p className="absolute top-3 left-0 -translate-x-1/2 rounded-md bg-background/90 px-2.5 py-1 text-xs whitespace-nowrap text-muted-foreground shadow-sm ring-1 ring-foreground/10 pointer-coarse:hidden">
          Hold <Kbd className="h-4 min-w-4 text-[0.65rem]">Q</Kbd>, point and let go
        </p>
        <button
          type="button"
          aria-label="Close the emote wheel"
          onClick={closeEmoteWheel}
          className="sr-only focus:not-sr-only focus:absolute focus:top-10 focus:left-0 focus:-translate-x-1/2 focus:rounded-md focus:bg-background focus:px-2 focus:py-1 focus:text-xs"
        >
          Close
        </button>
      </div>
    </div>
  );
}

/** A small chip under the top row while the coffee boost lasts: "Caffeinated · 24 s". */
export function CaffeinatedChip() {
  const until = useGame((s) => s.caffeinatedUntil);
  const [left, setLeft] = useState(0);

  useEffect(() => {
    if (until <= Date.now()) {
      // Deferred: a state update straight from an effect body would render twice.
      const reset = window.setTimeout(() => setLeft(0), 0);
      return () => window.clearTimeout(reset);
    }
    const tick = () => setLeft(Math.max(0, Math.ceil((until - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [until]);

  if (left <= 0) return null;
  return (
    <p
      data-caffeinated=""
      className="pointer-events-none flex items-center gap-1.5 self-start rounded-lg bg-background/92 px-2.5 py-1.5 text-sm font-medium shadow-sm ring-1 ring-foreground/10"
    >
      <CoffeeIcon className="size-4 text-primary" aria-hidden />
      Caffeinated
      <span className="font-mono text-xs text-muted-foreground tabular-nums">{left} s</span>
    </p>
  );
}
