"use client";

import { CheckIcon, Music2Icon, VolumeXIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { audio } from "@/game/audio/audio";
import { type JukeboxChoice, TRACKS } from "@/game/audio/jukebox";
import { emit } from "@/game/quests/bus";
import { useGame } from "@/game/store/game-store";
import { cn } from "@/lib/utils";

/**
 * The jukebox (phase O8 › Ambient activities): picks the play area's music for this visit, or
 * turns it off. The music plays only while the player is in the play area, at the music volume.
 */
export function JukeboxDialog() {
  const open = useGame((s) => s.modal?.type === "jukebox");
  const choice = useGame((s) => s.jukebox);

  function close() {
    audio.play("ui-close", { volume: 0.4 });
    useGame.getState().closeModal();
  }
  function pick(next: JukeboxChoice) {
    audio.play("ui-click", { volume: 0.4 });
    useGame.getState().setJukebox(next);
    emit({ type: "jukebox_changed", track: next });
  }

  const options: { id: JukeboxChoice; name: string; detail: string }[] = [...TRACKS, { id: "off", name: "Off", detail: "Quiet in the play area" }];

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="gap-4 sm:max-w-sm" data-jukebox-dialog="">
        <div className="flex flex-col gap-1">
          <DialogTitle className="text-lg">Jukebox</DialogTitle>
          <DialogDescription>Pick what plays in the play area. Turn the music volume up or down in the menu.</DialogDescription>
        </div>
        <div role="radiogroup" aria-label="Track" className="flex flex-col gap-1">
          {options.map((option, index) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={choice === option.id}
              autoFocus={choice === option.id || (index === 0 && !options.some((o) => o.id === choice))}
              onClick={() => pick(option.id)}
              className={cn(
                "flex items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                choice === option.id ? "bg-accent text-accent-foreground" : "hover:bg-muted",
              )}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
                {option.id === "off" ? <VolumeXIcon className="size-4" aria-hidden /> : <Music2Icon className="size-4" aria-hidden />}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium">{option.name}</span>
                <span className="truncate text-xs text-muted-foreground">{option.detail}</span>
              </span>
              {choice === option.id && <CheckIcon className="size-4" aria-hidden />}
            </button>
          ))}
        </div>
        <Button variant="outline" onClick={close}>
          Done
        </Button>
      </DialogContent>
    </Dialog>
  );
}
