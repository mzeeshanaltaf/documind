"use client";

import { CheckIcon, MedalIcon, RotateCcwIcon, TrophyIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { submitScore } from "@/app/(game)/actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { audio } from "@/game/audio/audio";
import type { SubmitScoreInput } from "@/game/games/scoring";
import { GAME_NAMES, type GameOutcome } from "@/game/games/types";
import { emit } from "@/game/quests/bus";
import { useGame } from "@/game/store/game-store";

/**
 * The card a finished game ends on (phase O8): the score, the game's own details, and the
 * score's fate. It submits once on mount; a refusal (rate limit, no connection) offers a retry.
 * Outside an office (the dev sandbox) nothing is saved.
 */
type Status =
  | { kind: "saving" }
  | { kind: "saved"; rank: number; personalBest: boolean }
  | { kind: "failed"; message: string }
  | { kind: "unsaved"; reason: "sandbox" | "empty" };

type Props = {
  outcome: GameOutcome;
  heading: string;
  /** The game's own breakdown and any citation. */
  children?: ReactNode;
  onAgain: () => void;
  onQuit: () => void;
};

export function GameResult({ outcome, heading, children, onAgain, onQuit }: Props) {
  const orgId = useGame((s) => s.office?.org.id ?? null);
  const orgName = useGame((s) => s.office?.org.name ?? "");
  // A round with nothing scored isn't worth a place on the board, and the sandbox has no org.
  const [status, setStatus] = useState<Status>(
    !orgId ? { kind: "unsaved", reason: "sandbox" } : outcome.score <= 0 ? { kind: "unsaved", reason: "empty" } : { kind: "saving" },
  );
  const sent = useRef(false);

  function save() {
    if (!orgId || outcome.score <= 0) return;
    setStatus({ kind: "saving" });
    const input = { orgId, game: outcome.game, score: outcome.score, details: outcome.details } as { orgId: string } & SubmitScoreInput;
    submitScore(input).then(
      (result) => {
        if (result.ok) {
          setStatus({ kind: "saved", rank: result.rank, personalBest: result.personalBest });
          useGame.getState().bumpScores();
          emit({ type: "score_submitted", game: outcome.game, score: outcome.score, rank: result.rank, personalBest: result.personalBest });
          if (result.personalBest) audio.play("success", { volume: 0.5 });
        } else {
          setStatus({ kind: "failed", message: result.retryAfterSeconds ? `${result.error} Try again in ${result.retryAfterSeconds} s.` : result.error });
        }
      },
      () => setStatus({ kind: "failed", message: "Couldn't save your score. Check your connection and try again." }),
    );
  }

  useEffect(() => {
    // Once per card, even when development runs effects twice.
    if (sent.current) return;
    sent.current = true;
    emit({ type: "game_finished", game: outcome.game, score: outcome.score, details: outcome.details });
    save();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once, for this outcome.
  }, []);

  return (
    <section
      data-game-result=""
      aria-labelledby="game-result-heading"
      className="flex w-full max-w-md flex-col gap-4 rounded-xl bg-popover p-5 text-popover-foreground shadow-lg ring-1 ring-foreground/10"
    >
      <header className="flex flex-col gap-1">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{GAME_NAMES[outcome.game]}</p>
        <h3 id="game-result-heading" className="font-heading text-2xl leading-tight font-semibold">
          {heading}
        </h3>
        <p className="flex items-baseline gap-2">
          <span data-game-score="" className="font-heading text-5xl leading-none font-semibold tabular-nums">
            {outcome.score}
          </span>
          <span className="text-sm text-muted-foreground">points</span>
        </p>
      </header>

      {children}

      <p aria-live="polite" data-score-status={status.kind} className="flex min-h-6 items-center gap-2 text-sm">
        {status.kind === "saving" && (
          <>
            <Spinner className="size-4" aria-hidden /> Saving your score…
          </>
        )}
        {status.kind === "saved" && (
          <>
            {status.rank === 1 ? <TrophyIcon className="size-4 text-primary" aria-hidden /> : <MedalIcon className="size-4 text-primary" aria-hidden />}
            <span>
              <span className="font-medium">Rank {status.rank}</span>
              {orgName ? ` on the ${orgName} board` : ""}
              {status.personalBest ? " · your best yet" : ""}
            </span>
          </>
        )}
        {status.kind === "failed" && (
          <>
            <span className="text-destructive">{status.message}</span>
            <Button size="sm" variant="outline" onClick={save}>
              Try again
            </Button>
          </>
        )}
        {status.kind === "unsaved" && (
          <>
            <CheckIcon className="size-4 text-muted-foreground" aria-hidden />
            <span className="text-muted-foreground">{status.reason === "empty" ? "No points this time, so nothing to save." : "Scores aren't saved here."}</span>
          </>
        )}
      </p>

      <footer className="flex flex-wrap gap-2">
        <Button autoFocus onClick={onAgain}>
          <RotateCcwIcon data-icon="inline-start" aria-hidden />
          Play again
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            audio.play("ui-open", { volume: 0.4 });
            useGame.getState().openModal({ type: "leaderboard" });
          }}
        >
          Leaderboards
        </Button>
        <Button variant="ghost" onClick={onQuit}>
          Quit
        </Button>
      </footer>
    </section>
  );
}
