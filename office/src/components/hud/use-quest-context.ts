import { useMemo } from "react";
import { questContext } from "@/game/quests/context";
import type { QuestContext } from "@/game/quests/definitions";
import { useGame } from "@/game/store/game-store";

/** The journal's view of the org, sized the same way the engine sizes it. */
export function useQuestContext(): QuestContext {
  const office = useGame((s) => s.office);
  return useMemo(() => questContext(office), [office]);
}
