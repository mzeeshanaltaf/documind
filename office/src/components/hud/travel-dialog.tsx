"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { emit } from "@/game/quests/bus";
import { useGame } from "@/game/store/game-store";

/** A Global Hub kiosk: "Travel to Berlin?", then on to that office's street. */
export function TravelDialog() {
  const travel = useGame((s) => (s.modal?.type === "travel" ? s.modal : null));
  const router = useRouter();
  const [going, setGoing] = useState(false);
  const close = () => {
    if (!going) useGame.getState().closeModal();
  };

  function go() {
    const { office } = useGame.getState();
    if (!travel || !office) return;
    setGoing(true);
    emit({ type: "travelled", from: office.place.id, to: travel.locationId });
    router.push(`/${office.org.slug}/${travel.locationId}`);
  }

  return (
    <Dialog open={travel !== null} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-md" showCloseButton={!going}>
        {travel && (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl font-semibold">Travel to {travel.name}?</DialogTitle>
              <DialogDescription>{travel.detail}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={close} disabled={going}>
                Stay here
              </Button>
              <Button autoFocus onClick={go} disabled={going}>
                {going && <Spinner data-icon="inline-start" />}
                {going ? "Travelling…" : "Travel"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
