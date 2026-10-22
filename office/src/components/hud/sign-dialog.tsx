"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useGame } from "@/game/store/game-store";

/** Reading a sign or notice in the world. */
export function SignDialog() {
  const sign = useGame((s) => (s.modal?.type === "sign" ? s.modal : null));
  const close = () => useGame.getState().closeModal();

  return (
    <Dialog open={sign !== null} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-md">
        {sign && (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl font-semibold">{sign.title}</DialogTitle>
              <DialogDescription className="sr-only">A notice in the room</DialogDescription>
            </DialogHeader>
            <div className="flex max-w-[65ch] flex-col gap-2.5 font-serif text-[0.9375rem] leading-relaxed">
              {sign.lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
            <DialogFooter>
              <Button autoFocus onClick={close}>
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
