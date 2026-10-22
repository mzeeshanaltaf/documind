"use client";

import { CheckIcon } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { issueCards } from "@/app/(game)/actions";
import { FormAlert } from "@/components/auth/form-alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { themeFor } from "@/content/room-themes";
import { audio } from "@/game/audio/audio";
import { emit } from "@/game/quests/bus";
import { useGame } from "@/game/store/game-store";
import { useOfficeDepartments } from "@/game/world/office/use-floorplan";
import { cn } from "@/lib/utils";
import { DepartmentIcon } from "./department-icon";

/**
 * Reception's access cards (phase O5 › Reception): every department room with what you can ask
 * there. "Take all" or pick some; the badge printer slides the new cards out, and they join the
 * HUD's card wallet. Cards already held are marked.
 */
export function CardPicker({ onDone }: { onDone: () => void }) {
  const departments = useOfficeDepartments();
  const held = useGame((s) => s.player.cards);
  const orgId = useGame((s) => s.office?.org.id);
  const [picked, setPicked] = useState<string[]>([]);
  const [printed, setPrinted] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = useId();
  const missing = departments.filter((department) => !held.includes(department));

  function print(selection: string[]) {
    if (!orgId || selection.length === 0) return;
    setError(null);
    startTransition(async () => {
      const result = await issueCards(orgId, selection);
      if (!result.ok) {
        audio.play("ui-deny", { volume: 0.5 });
        setError(result.error);
        return;
      }
      useGame.getState().setCards(result.cards);
      emit({ type: "badge_issued", departments: selection });
      audio.play("card-beep", { volume: 0.6 });
      audio.play("success", { volume: 0.5 });
      setPicked([]);
      setPrinted(selection);
    });
  }

  if (printed) return <Printed departments={printed} onDone={onDone} />;

  if (departments.length === 0) {
    return <p className="text-[0.9375rem] leading-relaxed">This office has no department rooms yet, so there are no cards to print.</p>;
  }

  return (
    <>
      <p className="text-[0.9375rem] leading-relaxed">
        {missing.length === 0
          ? "You already hold every card for this office. They open the department rooms down the corridor."
          : "Which rooms do you need? Each card opens one department's room; any card gets you through the security door."}
      </p>
      {/* A div, not a fieldset: fieldsets don't shrink and scroll inside a flex column. */}
      <div role="group" aria-label="Access cards" className="-mx-1 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1 py-0.5">
        {departments.map((department) => {
          const has = held.includes(department);
          const checked = has || picked.includes(department);
          const inputId = `${id}-${department}`;
          return (
            <label
              key={department}
              htmlFor={inputId}
              className={cn(
                "flex items-center gap-3 rounded-lg px-2 py-1.5 has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                has ? "text-muted-foreground" : "cursor-pointer hover:bg-muted",
              )}
            >
              <input
                id={inputId}
                type="checkbox"
                className="size-4 shrink-0 accent-primary"
                checked={checked}
                disabled={has || pending}
                onChange={(event) =>
                  setPicked((current) => (event.target.checked ? [...current, department] : current.filter((d) => d !== department)))
                }
              />
              <span
                className="flex size-8 shrink-0 items-center justify-center rounded-md"
                style={{ backgroundColor: themeFor(department).accent, color: "#f9fcfa" }}
              >
                <DepartmentIcon department={department} className="size-4" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium text-foreground">{department}</span>
                <span className="truncate text-xs text-muted-foreground">{themeFor(department).blurb}</span>
              </span>
              {has && (
                <span className="flex shrink-0 items-center gap-1 text-xs">
                  <CheckIcon className="size-3.5" aria-hidden />
                  Held
                </span>
              )}
            </label>
          );
        })}
      </div>
      {error && <FormAlert message={error} />}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={() => print(picked)} disabled={pending || picked.length === 0}>
          Print {picked.length > 0 ? picked.length : ""} selected
        </Button>
        <Button onClick={() => print(missing)} disabled={pending || missing.length === 0} autoFocus={missing.length > 0}>
          {pending && <Spinner data-icon="inline-start" />}
          {pending ? "Printing…" : missing.length === departments.length ? "Take all" : `Take the other ${missing.length}`}
        </Button>
      </div>
    </>
  );
}

/** The badge printer: each new card slides out of the slot in turn. */
function Printed({ departments, onDone }: { departments: string[]; onDone: () => void }) {
  const name = useGame((s) => s.player.displayName);
  return (
    <>
      <p className="text-[0.9375rem] leading-relaxed" role="status">
        {departments.length === 1 ? `Here's your ${departments[0]} card.` : `Here are your ${departments.length} cards.`}{" "}
        {"They're in your wallet, bottom left."}
      </p>
      <div className="flex flex-col items-center gap-0">
        <div aria-hidden className="h-2.5 w-64 max-w-full rounded-full bg-foreground/80" />
        <div className="-mt-1 flex w-full flex-wrap justify-center gap-2 overflow-hidden px-2 pt-1 pb-1">
          {departments.map((department, index) => (
            <div
              key={department}
              className="badge-print flex h-16 w-28 flex-col justify-between overflow-hidden rounded-md bg-card p-2 text-card-foreground shadow-sm ring-1 ring-foreground/10"
              style={{ animationDelay: `${index * 90}ms`, borderTop: `4px solid ${themeFor(department).accent}` }}
            >
              <span className="flex items-center gap-1.5 text-xs font-semibold">
                <DepartmentIcon department={department} className="size-3.5" />
                {department}
              </span>
              <span className="truncate text-[0.65rem] text-muted-foreground">{name}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex justify-end">
        <Button autoFocus onClick={onDone}>
          Done
        </Button>
      </div>
    </>
  );
}
