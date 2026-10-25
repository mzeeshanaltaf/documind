"use client";

import { MedalIcon } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { getLeaderboards } from "@/app/(game)/actions";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { audio } from "@/game/audio/audio";
import { GAME_IDS, GAME_NAMES } from "@/game/games/types";
import { useGame } from "@/game/store/game-store";
import type { LeaderboardEntry, Period } from "@/lib/leaderboard";
import { cn } from "@/lib/utils";

/**
 * The leaderboards as a DOM page (phase O8 › Scores & leaderboard), opened with E at the wall or
 * from a result card: each game's top ten for the org, this week or all time. Only members of
 * the org see it; players who hide themselves in the settings aren't listed.
 */
export function LeaderboardDialog() {
  const open = useGame((s) => s.modal?.type === "leaderboard");
  function close() {
    audio.play("ui-close", { volume: 0.4 });
    useGame.getState().closeModal();
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="flex max-h-[min(92dvh,44rem)] flex-col gap-4 overflow-hidden sm:max-w-4xl" data-leaderboard-dialog="">
        {open && <Board />}
      </DialogContent>
    </Dialog>
  );
}

const PERIOD_LABELS: Record<Period, string> = { week: "This week", all: "All time" };

function Board() {
  const orgId = useGame((s) => s.office?.org.id ?? null);
  const orgName = useGame((s) => s.office?.org.name ?? "");
  const version = useGame((s) => s.scoresVersion);
  const [period, setPeriod] = useState<Period>("week");
  const { data, error, isLoading } = useSWR(orgId ? (["leaderboards", orgId, period, version] as const) : null, ([, id, p]) => getLeaderboards({ orgId: id, period: p }));

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-3 pr-8">
        <div className="flex flex-col gap-1">
          <DialogTitle className="text-lg">Leaderboards</DialogTitle>
          <DialogDescription>
            {orgName ? `${orgName}: ` : ""}each player&apos;s best score. Names are a first name and an initial.
          </DialogDescription>
        </div>
        <div role="radiogroup" aria-label="Period" className="flex gap-1.5">
          {(Object.keys(PERIOD_LABELS) as Period[]).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={period === value}
              onClick={() => setPeriod(value)}
              className={cn(
                "h-8 rounded-md px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                period === value ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-accent",
              )}
            >
              {PERIOD_LABELS[value]}
            </button>
          ))}
        </div>
      </header>

      {!orgId ? (
        <p className="text-sm text-muted-foreground">Leaderboards need an office to belong to.</p>
      ) : error || data === null ? (
        <p role="alert" className="text-sm text-destructive">
          The leaderboards couldn&apos;t be loaded.
        </p>
      ) : (
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto md:grid-cols-3">
          {GAME_IDS.map((game) => (
            <section key={game} data-leaderboard-game={game} aria-labelledby={`board-${game}`} className="flex min-w-0 flex-col gap-2">
              <h3 id={`board-${game}`} className="font-heading text-base font-semibold">
                {GAME_NAMES[game]}
              </h3>
              {isLoading || !data ? <Rows loading /> : <Rows entries={data[game]} />}
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function Rows({ entries, loading }: { entries?: LeaderboardEntry[]; loading?: boolean }) {
  if (loading) {
    return (
      <div className="flex flex-col gap-1.5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }
  if (!entries || entries.length === 0) return <p className="text-sm text-muted-foreground">No scores yet. Be the first.</p>;
  return (
    <ol className="flex flex-col gap-1">
      {entries.map((entry) => (
        <li
          key={`${entry.rank}:${entry.name}`}
          data-leaderboard-row=""
          data-mine={entry.mine || undefined}
          className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-sm", entry.mine ? "bg-accent text-accent-foreground" : "bg-muted/50")}
        >
          <span className="flex w-6 shrink-0 items-center justify-center font-mono text-xs text-muted-foreground tabular-nums">
            {entry.rank <= 3 ? <MedalIcon className="size-4 text-primary" aria-label={`Rank ${entry.rank}`} /> : entry.rank}
          </span>
          <span className="min-w-0 flex-1 truncate">
            {entry.name}
            {entry.mine && <span className="ml-1.5 text-xs text-muted-foreground">you</span>}
          </span>
          <span className="font-mono tabular-nums">{entry.score}</span>
        </li>
      ))}
    </ol>
  );
}
