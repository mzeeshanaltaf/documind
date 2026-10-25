"use client";

import { XIcon } from "lucide-react";
import { lazy, Suspense } from "react";
import { PdfViewer } from "@/components/pdf/pdf-viewer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { audio } from "@/game/audio/audio";
import { GAME_NAMES, type GameId } from "@/game/games/types";
import { useGame } from "@/game/store/game-store";

const TriviaGame = lazy(() => import("./trivia-game"));
const SortTossGame = lazy(() => import("./sort-toss-game"));
const TableTennisGame = lazy(() => import("./table-tennis-game"));

/**
 * Game mode (phase O8 › Starting a game): the mini-game takes the screen in a full-size dialog
 * while the camera stays locked on its station. Esc (or Quit) leaves it; the dialog traps focus
 * and the world's keys are ignored meanwhile. Each game is its own lazy chunk. The PDF sheet is
 * nested here so Policy Trivia's "Show source" opens beside the question, as in the NPC dialogue.
 */
export function GameDialog() {
  const game = useGame((s) => (s.modal?.type === "game" ? s.modal.game : null));

  function close() {
    audio.play("ui-close", { volume: 0.4 });
    useGame.getState().closeModal();
  }

  return (
    <Dialog open={game !== null} onOpenChange={(next) => !next && close()}>
      <DialogContent
        data-game-dialog={game ?? ""}
        showCloseButton={false}
        // No backdrop blur: it is re-composited on every frame a game canvas draws, which software
        // rendering (and a low-end GPU) can't keep up with.
        overlayClassName="bg-black/25 supports-backdrop-filter:backdrop-blur-none"
        className="flex h-[min(94dvh,48rem)] max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl"
      >
        {game && (
          <>
            <header className="flex items-center gap-3 border-b px-4 py-2.5">
              <DialogTitle className="flex-1 truncate text-base">{GAME_NAMES[game]}</DialogTitle>
              <DialogDescription className="sr-only">{DESCRIPTIONS[game]}</DialogDescription>
              <Button variant="ghost" size="sm" onClick={close} data-game-quit="">
                <XIcon data-icon="inline-start" aria-hidden />
                Quit
                <Kbd className="max-sm:hidden">Esc</Kbd>
              </Button>
            </header>
            <div className="relative flex min-h-0 flex-1 flex-col bg-muted/40">
              <Suspense
                fallback={
                  <div className="flex flex-1 items-center justify-center">
                    <Spinner className="size-6" aria-label="Loading the game" />
                  </div>
                }
              >
                <Game key={game} game={game} onQuit={close} />
              </Suspense>
            </div>
            <PdfViewer />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

const DESCRIPTIONS: Record<GameId, string> = {
  trivia: "Ten questions from the company's documents. Press 1 to 4 to answer.",
  sort_toss: "Sort office waste into the right bin. Drag back and release to throw, or use the arrow keys and hold Space.",
  table_tennis: "A short match to seven points. Move the paddle with the mouse, touch or the arrow keys.",
};

function Game({ game, onQuit }: { game: GameId; onQuit: () => void }) {
  if (game === "trivia") return <TriviaGame onQuit={onQuit} />;
  if (game === "sort_toss") return <SortTossGame onQuit={onQuit} />;
  return <TableTennisGame onQuit={onQuit} />;
}
