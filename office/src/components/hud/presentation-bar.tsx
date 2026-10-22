"use client";

import { ChevronLeftIcon, ChevronRightIcon, Maximize2Icon, PresentationIcon, Volume2Icon, VolumeXIcon } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { audio } from "@/game/audio/audio";
import { useGame } from "@/game/store/game-store";
import { currentEntry, useProgramme } from "@/game/world/office/presentation/use-programme";
import { cn } from "@/lib/utils";

/**
 * The presentation room's controls (phase O7), bottom centre. Standing in the room: what's on
 * screen and "View full screen". Seated: previous / next (also ←/→), full screen, unmute while the
 * video plays (when it has sound), and stand up (also E or Esc). Slide changes are announced.
 */
const ROOM = "Presentation room";

export function PresentationBar() {
  const show = useGame((s) => s.world.scene === "office" && s.world.phase === "ready" && s.world.location.room === ROOM && s.modal === null);
  return show ? <Bar /> : null;
}

const panel = "pointer-events-auto rounded-lg bg-background/95 shadow-md ring-1 ring-foreground/10";
const control =
  "flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50";

function Bar() {
  const programme = useProgramme();
  const slide = useGame((s) => s.presentation.slide);
  const seated = useGame((s) => s.player.pose === "sit" && !!s.player.seat?.view);
  const muted = useGame((s) => s.presentation.muted);
  const entry = currentEntry(programme, slide);
  if (!entry) return null;

  const step = (delta: number) => {
    audio.play("ui-click", { volume: 0.35 });
    useGame.getState().stepSlide(delta);
  };
  const fullScreen = () => {
    audio.play("ui-open", { volume: 0.45 });
    useGame.getState().openModal({ type: "slides" });
  };
  const video = entry.slide.kind === "video" ? entry.slide.video : undefined;
  const counter = `${entry.index + 1} / ${entry.total}`;

  return (
    <div data-presentation-bar="" className={cn(panel, "flex max-w-[calc(100vw-1.5rem)] items-center gap-1 p-1")}>
      {seated && (
        <button type="button" className={control} onClick={() => step(-1)} aria-label="Previous slide">
          <ChevronLeftIcon className="size-4" aria-hidden />
        </button>
      )}
      <p className="flex min-w-0 items-center gap-2 px-1.5 text-sm" aria-live={seated ? "polite" : "off"}>
        {!seated && <PresentationIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
        <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{counter}</span>
        <span className="truncate font-medium">
          <span className="sr-only">{entry.deck.title}: </span>
          {entry.slide.title}
        </span>
      </p>
      {seated && (
        <button type="button" className={control} onClick={() => step(1)} aria-label="Next slide">
          <ChevronRightIcon className="size-4" aria-hidden />
        </button>
      )}
      <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-border" />
      <button type="button" className={control} onClick={fullScreen}>
        <Maximize2Icon className="size-4" aria-hidden />
        <span className={cn(seated && "max-sm:sr-only")}>View full screen</span>
      </button>
      {seated && video?.hasAudio && (
        <button type="button" className={control} onClick={() => useGame.getState().setVideoMuted(!muted)} aria-pressed={!muted}>
          {muted ? <VolumeXIcon className="size-4" aria-hidden /> : <Volume2Icon className="size-4" aria-hidden />}
          <span className="max-sm:sr-only">{muted ? "Unmute" : "Mute"}</span>
        </button>
      )}
      {seated && (
        <button type="button" className={control} onClick={() => useGame.getState().stand()}>
          <Kbd className="max-sm:hidden">E</Kbd>
          Stand up
        </button>
      )}
    </div>
  );
}
