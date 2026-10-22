"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type { KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { audio } from "@/game/audio/audio";
import { useGame } from "@/game/store/game-store";
import { SlideView } from "@/game/world/office/presentation/deck";
import { currentEntry, useProgramme } from "@/game/world/office/presentation/use-programme";

/**
 * "View full screen" (phase O7 › Slide engine): the slide on the auditorium screen as a readable
 * page, for small screens and screen readers. ←/→ and the buttons page the same running
 * presentation (the screen follows), and the loop waits while it's open.
 */
export function SlidesDialog() {
  const open = useGame((s) => s.modal?.type === "slides");
  const close = () => {
    audio.play("ui-close", { volume: 0.4 });
    useGame.getState().closeModal();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="flex max-h-[min(92dvh,48rem)] flex-col gap-0 p-0 sm:max-w-3xl">{open && <SlidesPanel />}</DialogContent>
    </Dialog>
  );
}

function SlidesPanel() {
  const programme = useProgramme();
  const slide = useGame((s) => s.presentation.slide);
  const office = useGame((s) => s.office);
  const entry = currentEntry(programme, slide);
  if (!entry) return null;
  const place = office ? { id: office.place.id, name: office.place.name, hub: office.place.role === "hub" } : null;
  const step = (delta: number) => {
    audio.play("ui-click", { volume: 0.35 });
    useGame.getState().stepSlide(delta);
  };

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // The video's own controls use the arrow keys to seek.
    if (event.target instanceof HTMLVideoElement || event.target instanceof HTMLInputElement) return;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      step(event.key === "ArrowRight" ? 1 : -1);
    }
  }

  const position = `${entry.deck.title}, slide ${entry.index + 1} of ${entry.total}`;

  return (
    <div className="flex min-h-0 flex-col" onKeyDown={onKeyDown}>
      <DialogDescription className="sr-only">
        {position}. Use the left and right arrow keys, or the buttons, to change slides.
      </DialogDescription>
      <p className="sr-only" aria-live="polite">
        {position}: {entry.slide.title}
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-5 sm:px-8 sm:pt-6">
        <SlideView
          key={`${entry.deck.id}:${entry.slide.id}`}
          entry={entry}
          variant="page"
          place={place}
          className="pr-6"
          renderTitle={({ className, children }) => <DialogTitle className={className}>{children}</DialogTitle>}
        />
      </div>
      <footer className="flex items-center justify-between gap-2 border-t border-border bg-muted/50 px-3 py-2.5 sm:px-4">
        <Button variant="outline" size="sm" onClick={() => step(-1)}>
          <ChevronLeftIcon data-icon="inline-start" aria-hidden />
          Previous
        </Button>
        <span className="truncate text-center font-mono text-xs text-muted-foreground tabular-nums">
          {entry.index + 1} / {entry.total} · {entry.deck.title}
        </span>
        <Button size="sm" autoFocus onClick={() => step(1)}>
          Next
          <ChevronRightIcon data-icon="inline-end" aria-hidden />
        </Button>
      </footer>
    </div>
  );
}
