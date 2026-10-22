"use client";

import { DepartmentIcon } from "@/components/dialogue/department-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { themeFor } from "@/content/room-themes";
import { useGame } from "@/game/store/game-store";
import { orderDepartments } from "@/lib/departments";

/**
 * The access cards held, bottom left (phase O5 › Reception): a fanned stack of small cards in
 * each department's colour; hover or focus names the department.
 */
export function CardWallet() {
  const cards = useGame((s) => s.player.cards);
  if (cards.length === 0) return null;
  const ordered = orderDepartments(cards);

  return (
    <section aria-label="Access cards" className="pointer-events-auto flex items-end rounded-lg bg-background/92 p-1.5 shadow-sm ring-1 ring-foreground/10">
      <ul className="flex items-end">
        {ordered.map((department, index) => (
          <li key={department} className={index > 0 ? "-ml-2.5" : undefined}>
            <Tooltip>
              <TooltipTrigger
                render={<span tabIndex={0} aria-label={`${department} card`} />}
                className="flex h-9 w-7 items-start justify-center rounded-[5px] pt-1.5 shadow-sm ring-1 ring-foreground/15 outline-none transition-transform duration-150 hover:-translate-y-1 focus-visible:-translate-y-1 focus-visible:ring-3 focus-visible:ring-ring/50"
                style={{ backgroundColor: themeFor(department).accent, color: "#f9fcfa" }}
              >
                <DepartmentIcon department={department} className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent side="top">{department} card</TooltipContent>
            </Tooltip>
          </li>
        ))}
      </ul>
    </section>
  );
}
