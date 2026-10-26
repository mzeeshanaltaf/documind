"use client";

import { TelescopeIcon } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { audio } from "@/game/audio/audio";
import { useGame } from "@/game/store/game-store";

/**
 * The rooftop telescope's caption (phase O9 › Rooftop): the landmark's name and fun fact over the
 * zoomed view. It isn't a dialog, so the view stays sharp (no backdrop blur) and the world keeps
 * rendering; E or Esc steps back, as does the button.
 */
export function TelescopeCaption() {
  const scope = useGame((s) => (s.modal?.type === "telescope" ? s.modal : null));
  const open = scope !== null;

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" && event.code !== "KeyE") return;
      event.preventDefault();
      audio.play("ui-close", { volume: 0.4 });
      useGame.getState().closeModal();
    }
    // On the next task: attached at once, it would see the very E press that opened the telescope
    // (the same trap as the Esc menu; see the 3D gotchas).
    const arm = window.setTimeout(() => window.addEventListener("keydown", onKey), 0);
    return () => {
      window.clearTimeout(arm);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!scope) return null;
  return (
    <section
      aria-labelledby="telescope-title"
      className="pointer-events-auto fixed inset-x-0 bottom-6 z-20 mx-auto flex w-[min(34rem,calc(100vw-2rem))] flex-col gap-3 rounded-xl bg-popover p-4 text-popover-foreground shadow-lg ring-1 ring-foreground/10"
    >
      <header className="flex items-center gap-2">
        <TelescopeIcon className="size-5 text-primary" aria-hidden />
        <h2 id="telescope-title" className="font-heading text-xl font-semibold">
          {scope.title}
        </h2>
      </header>
      {scope.lines.map((line) => (
        <p key={line} className="max-w-[65ch] font-serif text-[0.9375rem] leading-relaxed">
          {line}
        </p>
      ))}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground max-sm:hidden">
          <Kbd>E</Kbd> or <Kbd>Esc</Kbd> to step back
        </p>
        <Button
          autoFocus
          size="sm"
          className="ml-auto"
          onClick={() => {
            audio.play("ui-close", { volume: 0.4 });
            useGame.getState().closeModal();
          }}
        >
          Step back
        </Button>
      </div>
    </section>
  );
}
