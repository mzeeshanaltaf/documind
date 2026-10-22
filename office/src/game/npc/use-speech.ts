import { useEffect, useState } from "react";
import { firstSentence } from "@/game/chat/speech";
import { isStreaming } from "@/game/chat/sse";
import { useGame } from "@/game/store/game-store";
import type { Speech } from "./Npc";

/** How long a finished answer's first sentence stays over the NPC. */
const LINGER_MS = 6000;

/**
 * What an NPC's bubble shows: the typing indicator while an answer is looked up, its first
 * sentence once complete (kept for 6 s after the answer ends), else `idle` (a call-out) or nothing.
 */
export function useNpcSpeech(key: string, idle: string | null): Speech {
  const live = useGame((s) => {
    const turn = s.chat[key]?.turns.at(-1);
    if (!turn || !isStreaming(turn)) return null;
    return firstSentence(turn.content, false) ?? "";
  });
  const [lingering, setLingering] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = useGame.subscribe((state, previous) => {
      const turn = state.chat[key]?.turns.at(-1);
      const before = previous.chat[key]?.turns.find((t) => t === turn || (turn && t.id === turn.id));
      if (!turn || turn.status !== "complete" || before?.status === "complete") return;
      const text = firstSentence(turn.content, true);
      if (!text) return;
      clearTimeout(timer);
      setLingering(text);
      timer = setTimeout(() => setLingering(null), LINGER_MS);
    });
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [key]);

  if (live !== null) return live ? { kind: "line", text: live } : { kind: "typing" };
  if (lingering) return { kind: "line", text: lingering };
  return idle ? { kind: "line", text: idle } : null;
}
