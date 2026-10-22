import { recordStats } from "@/app/(game)/actions";
import { bus } from "@/game/quests/bus";
import { useGame } from "@/game/store/game-store";

/**
 * Game stats on their way to `progress.stats` (phase O6 › Room visits): rooms entered and
 * citations opened, batched and saved through `recordStats` at most every 2 s, and flushed when
 * the page is hidden or the game unmounts. O9's `saveProgress` will carry quests the same way.
 */
const DEBOUNCE_MS = 2000;

type Pending = { orgId: string; rooms: Set<string>; citations: number };
let pending: Pending | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

function queue(orgId: string, change: { room?: string; citation?: boolean }) {
  // Another org's stats never mix into this batch.
  if (pending && pending.orgId !== orgId) void flushStats();
  pending ??= { orgId, rooms: new Set(), citations: 0 };
  if (change.room) pending.rooms.add(change.room);
  if (change.citation) pending.citations += 1;
  clearTimeout(timer);
  timer = setTimeout(() => void flushStats(), DEBOUNCE_MS);
}

export async function flushStats() {
  clearTimeout(timer);
  const batch = pending;
  pending = null;
  if (!batch || (batch.rooms.size === 0 && batch.citations === 0)) return;
  try {
    await recordStats(batch.orgId, { rooms_visited: [...batch.rooms], citations_opened: Math.min(100, batch.citations) });
  } catch (error) {
    // Stats are a nicety: a lost batch is only logged.
    console.error("[stats] not saved", error);
  }
}

/** Listens to the bus for as long as the game runs; returns the cleanup. */
export function startStats(): () => void {
  const orgId = () => useGame.getState().office?.org.id ?? null;
  const offRoom = bus.on("room_entered", (event) => {
    const org = orgId();
    if (org && event.location) queue(org, { room: `${event.location}/${event.room}` });
  });
  const offCitation = bus.on("citation_opened", () => {
    const org = orgId();
    if (org) queue(org, { citation: true });
  });
  const onHide = () => {
    if (document.visibilityState === "hidden") void flushStats();
  };
  const onPageHide = () => void flushStats();
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", onPageHide);
  return () => {
    offRoom();
    offCitation();
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", onPageHide);
    void flushStats();
  };
}
