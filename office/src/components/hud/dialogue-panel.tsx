"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Button } from "@/components/ui/button";
import { useGame } from "@/game/store/game-store";

/**
 * A conversation with an NPC: a panel along the bottom, leaving the speaker in view (the camera
 * frames both). Focus is trapped while it's open, but the world isn't dimmed. O5 replaces the
 * static lines with the expert chat.
 */
export function DialoguePanel() {
  const dialogue = useGame((s) => (s.modal?.type === "dialogue" ? s.modal : null));
  const close = () => useGame.getState().closeModal();

  return (
    <DialogPrimitive.Root open={dialogue !== null} onOpenChange={(next) => !next && close()} modal="trap-focus">
      <DialogPrimitive.Portal>
        <DialogPrimitive.Popup className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-xl flex-col gap-3 rounded-xl bg-popover p-4 text-popover-foreground shadow-lg ring-1 ring-foreground/10 duration-150 outline-none data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-bottom-2 data-closed:animate-out data-closed:fade-out-0">
          {dialogue && (
            <>
              <div className="flex flex-col gap-0.5">
                <DialogPrimitive.Title className="font-heading text-lg leading-tight font-semibold">
                  {dialogue.name}
                </DialogPrimitive.Title>
                <p className="text-xs text-muted-foreground">{dialogue.role}</p>
              </div>
              <DialogPrimitive.Description render={<div />} className="flex max-w-[65ch] flex-col gap-2 text-[0.9375rem] leading-relaxed">
                {dialogue.lines.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </DialogPrimitive.Description>
              <div className="flex justify-end">
                <Button autoFocus variant="outline" onClick={close}>
                  Goodbye
                </Button>
              </div>
            </>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
