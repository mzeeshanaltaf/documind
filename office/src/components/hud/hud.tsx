"use client";

import { ChevronRightIcon, MenuIcon } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { audio } from "@/game/audio/audio";
import { useGame } from "@/game/store/game-store";
import { cn } from "@/lib/utils";
import { ArrivalBanner } from "./arrival-banner";
import { AvatarEditor } from "./avatar-editor";
import { DialoguePanel } from "./dialogue-panel";
import { GameMenu } from "./game-menu";
import { InteractionPrompt } from "./interaction-prompt";
import { SignDialog } from "./sign-dialog";
import { TouchControls } from "./touch-controls";
import { TravelDialog } from "./travel-dialog";

const panel = "rounded-lg bg-background/92 shadow-sm ring-1 ring-foreground/10";

/**
 * The DOM HUD over the canvas. Corners: location (top left), quota slot + menu (top right,
 * quota arrives in O5), minimap slot (bottom right, O5); the interaction prompt sits bottom
 * centre, with the arrival banner (O4) under the top row. The layer itself ignores the pointer so the canvas still gets drags and wheel events.
 */
export function Hud() {
  const location = useGame((s) => s.world.location);
  const crumbs = [location.org, location.city, location.room].filter(Boolean) as string[];

  return (
    <>
      <div className="pointer-events-none fixed inset-0 z-10 flex flex-col justify-between p-3 select-none sm:p-4">
        <div className="flex items-start justify-between gap-3">
          <nav aria-label="Location" className={`${panel} pointer-events-auto min-w-0 px-3 py-1.5`}>
            <ol className="flex min-w-0 items-center gap-1.5 text-sm">
              {crumbs.map((crumb, index) => {
                const last = index === crumbs.length - 1;
                return (
                  <li
                    key={`${index}:${crumb}`}
                    aria-current={last ? "location" : undefined}
                    className={cn("flex min-w-0 items-center gap-1.5", !last && "text-muted-foreground max-sm:hidden")}
                  >
                    {index > 0 && (
                      <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground max-sm:hidden" />
                    )}
                    <span className={cn("truncate", last && "font-medium")}>{crumb}</span>
                  </li>
                );
              })}
            </ol>
          </nav>
          <div className="flex shrink-0 items-center gap-2">
            <div data-hud-slot="quota" />
            <button
              type="button"
              onClick={() => {
                audio.play("ui-open", { volume: 0.5 });
                useGame.getState().openModal({ type: "menu" });
              }}
              className={`${panel} pointer-events-auto flex h-9 items-center gap-2 px-2.5 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:hidden`}
            >
              <MenuIcon className="size-4" aria-hidden />
              Menu
              <Kbd className="max-sm:hidden">Esc</Kbd>
            </button>
          </div>
        </div>

        <div className="flex items-end justify-between gap-3">
          <div className="size-0" />
          <div className="flex min-w-0 flex-1 justify-center pb-1 pointer-coarse:pb-36">
            <InteractionPrompt />
          </div>
          <div data-hud-slot="minimap" />
        </div>
      </div>

      <ArrivalBanner />
      <TouchControls />
      <GameMenu />
      <AvatarEditor />
      <SignDialog />
      <DialoguePanel />
      <TravelDialog />
    </>
  );
}
