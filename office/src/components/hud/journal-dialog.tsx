"use client";

import { CheckIcon, LockIcon, MapPinIcon, TrophyIcon } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { audio } from "@/game/audio/audio";
import { bus } from "@/game/quests/bus";
import { ACHIEVEMENTS, type Progress, QUESTS, type QuestDef, type QuestContext } from "@/game/quests/definitions";
import { coreStatus, rooftopUnlocked } from "@/game/quests/engine";
import { guideTarget } from "@/game/quests/guide";
import { type JournalTab, useGame } from "@/game/store/game-store";
import { useFloorplan } from "@/game/world/office/use-floorplan";
import { cn } from "@/lib/utils";
import { useQuestContext } from "./use-quest-context";

const TABS: { id: JournalTab; label: string }[] = [
  { id: "quests", label: "Quests" },
  { id: "achievements", label: "Achievements" },
];

const date = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/**
 * The quest journal (phase O9 › UI), opened with J or the HUD button: core quests first with
 * progress bars and hints, then side quests; the achievements grid with locked ones greyed out.
 * "Show me" closes the journal and lays a trail on the floor to the quest's next step.
 */
export function JournalDialog() {
  const journal = useGame((s) => (s.modal?.type === "journal" ? s.modal : null));
  const tab = journal?.tab ?? "quests";

  // J opens it (the keyboard hook ignores keys while any dialog is open, so it never closes it).
  useEffect(
    () =>
      bus.on("hotkey", (event) => {
        if (event.action !== "journal") return;
        const { modal, openModal } = useGame.getState();
        if (!modal) {
          audio.play("ui-open", { volume: 0.5 });
          openModal({ type: "journal" });
        }
      }),
    [],
  );

  const setTab = (next: JournalTab) => {
    if (next !== tab) useGame.setState({ modal: { type: "journal", tab: next } });
  };

  return (
    <Dialog
      open={journal !== null}
      onOpenChange={(open) => {
        if (!open) useGame.getState().closeModal();
        audio.play(open ? "ui-open" : "ui-close", { volume: 0.5 });
      }}
    >
      <DialogContent className="max-h-[min(90dvh,44rem)] grid-rows-[auto_auto_minmax(0,1fr)] gap-3 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">Journal</DialogTitle>
          <DialogDescription>Finish the core quests to open the rooftop lounge.</DialogDescription>
        </DialogHeader>
        <Tabs tab={tab} onChange={setTab} />
        <div id={`journal-panel-${tab}`} role="tabpanel" aria-labelledby={`journal-tab-${tab}`} className="-mx-4 min-h-0 overflow-y-auto px-4 pb-1">
          {tab === "quests" ? <QuestList /> : <AchievementGrid />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Tabs({ tab, onChange }: { tab: JournalTab; onChange: (tab: JournalTab) => void }) {
  const refs = useRef<Record<JournalTab, HTMLButtonElement | null>>({ quests: null, achievements: null });
  const unlocked = useGame((s) => Object.keys(s.progress.achievements).length);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const next = tab === "quests" ? "achievements" : "quests";
    onChange(next);
    refs.current[next]?.focus();
  }

  return (
    <div role="tablist" aria-label="Journal" onKeyDown={onKeyDown} className="flex gap-1 border-b">
      {TABS.map(({ id, label }) => (
        <button
          key={id}
          ref={(node) => {
            refs.current[id] = node;
          }}
          type="button"
          role="tab"
          id={`journal-tab-${id}`}
          aria-selected={tab === id}
          aria-controls={`journal-panel-${id}`}
          tabIndex={tab === id ? 0 : -1}
          onClick={() => onChange(id)}
          className={cn(
            "-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            tab === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
          {id === "achievements" && <span className="ml-1.5 font-mono text-xs text-muted-foreground tabular-nums">{unlocked}/{ACHIEVEMENTS.length}</span>}
        </button>
      ))}
    </div>
  );
}

function QuestList() {
  const progress = useGame((s) => s.progress);
  const context = useQuestContext();
  const core = QUESTS.filter((quest) => quest.kind === "core");
  const side = QUESTS.filter((quest) => quest.kind === "side");
  const { done, total } = coreStatus(progress);

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="journal-core" className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h3 id="journal-core" className="font-heading text-base font-semibold">
            Core quests
          </h3>
          <p className="text-sm text-muted-foreground" data-rooftop={rooftopUnlocked(progress) ? "unlocked" : "locked"}>
            {rooftopUnlocked(progress) ? "Rooftop unlocked" : `Rooftop unlocks at ${done} of ${total}`}
          </p>
        </div>
        <ul className="flex flex-col gap-2">
          {core.map((quest) => (
            <QuestRow key={quest.id} quest={quest} progress={progress} context={context} />
          ))}
        </ul>
      </section>
      <section aria-labelledby="journal-side" className="flex flex-col gap-2">
        <h3 id="journal-side" className="font-heading text-base font-semibold">
          Side quests
        </h3>
        <ul className="flex flex-col gap-2">
          {side.map((quest) => (
            <QuestRow key={quest.id} quest={quest} progress={progress} context={context} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function QuestRow({ quest, progress, context }: { quest: QuestDef; progress: Progress; context: QuestContext }) {
  const state = progress.quests[quest.id];
  const done = Boolean(state?.done_at);
  const target = quest.target(context);
  const value = done ? target : Math.min(target, state?.progress ?? 0);
  const titleId = useId();

  return (
    <li
      aria-labelledby={titleId}
      data-quest={quest.id}
      data-done={done}
      className={cn("flex flex-col gap-2 rounded-lg border p-3", done && "bg-muted/50")}
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full ring-1", done ? "bg-primary text-primary-foreground ring-primary" : "ring-foreground/25")}
        >
          {done && <CheckIcon className="size-3.5" />}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p id={titleId} className="font-medium">
            {quest.title}
            {done && <span className="sr-only"> (complete)</span>}
          </p>
          <p className="text-sm text-muted-foreground">{quest.description}</p>
        </div>
        <p className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
          {value}/{target}
        </p>
      </div>
      <div
        role="progressbar"
        aria-label={`${quest.title} progress`}
        aria-valuemin={0}
        aria-valuemax={target}
        aria-valuenow={value}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${(value / target) * 100}%` }} />
      </div>
      {done ? (
        state?.done_at && <p className="text-xs text-muted-foreground">Done {date.format(new Date(state.done_at))}</p>
      ) : (
        <div className="flex items-end justify-between gap-3">
          <p className="min-w-0 text-sm text-muted-foreground">{quest.hint}</p>
          <ShowMe quest={quest} />
        </div>
      )}
    </li>
  );
}

function ShowMe({ quest }: { quest: QuestDef }) {
  const plan = useFloorplan();
  const inOffice = useGame((s) => s.world.scene === "office");

  function show() {
    const state = useGame.getState();
    const target = guideTarget(quest.id, plan, state.progress);
    if (!target) return;
    audio.play("ui-click", { volume: 0.5 });
    state.setGuide({ quest: quest.id, label: target.label, target: target.position });
    state.closeModal();
  }

  return (
    <Button
      size="sm"
      variant="outline"
      className="shrink-0"
      disabled={!inOffice}
      title={inOffice ? undefined : "Step inside the office first"}
      onClick={show}
    >
      <MapPinIcon data-icon="inline-start" aria-hidden />
      Show me
    </Button>
  );
}

function AchievementGrid() {
  const unlocked = useGame((s) => s.progress.achievements);
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {ACHIEVEMENTS.map((achievement) => {
        const at = unlocked[achievement.id];
        return (
          <li
            key={achievement.id}
            data-achievement={achievement.id}
            data-unlocked={Boolean(at)}
            className={cn("flex items-start gap-3 rounded-lg border p-3", !at && "bg-muted/40 text-muted-foreground")}
          >
            <span
              aria-hidden
              className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", at ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}
            >
              {at ? <TrophyIcon className="size-4.5" /> : <LockIcon className="size-4" />}
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className={cn("font-medium", at && "text-foreground")}>
                {achievement.title}
                <span className="sr-only">{at ? " (unlocked)" : " (locked)"}</span>
              </p>
              <p className="text-sm">{achievement.description}</p>
              <p className="text-xs">{at ? `Unlocked ${date.format(new Date(at))}` : "Locked"}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
