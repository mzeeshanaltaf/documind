import { saveProgress } from "@/app/(game)/actions";
import type { Progress } from "./definitions";
import { type ProgressPatch, toPatch } from "./schema";

/**
 * Quest progress on its way to `progress` in the database (phase O9 › Persistence): changes
 * are batched into one save every 2 s, and the last batch leaves with `navigator.sendBeacon` when
 * the page is hidden (a Server Action can't be called then). Each save sends the whole engine-owned
 * patch, which the server merges monotonically, so a repeated or reordered send is harmless.
 * A snapshot is kept per mark rather than read at flush time, so a batch always goes to the org
 * it was earned in.
 */
const DEBOUNCE_MS = 2000;
export const BEACON_PATH = "/api/progress";

let pending: { orgId: string; patch: ProgressPatch } | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Records that `progress` (in `orgId`) is newer than what is saved; saves it soon. */
export function markProgress(orgId: string, progress: Progress) {
  // Another org's batch never mixes with this one.
  if (pending && pending.orgId !== orgId) void flushProgress();
  pending = { orgId, patch: toPatch(progress) };
  clearTimeout(timer);
  timer = setTimeout(() => void flushProgress(), DEBOUNCE_MS);
}

/** Saves what is waiting, now. */
export async function flushProgress() {
  clearTimeout(timer);
  const batch = pending;
  pending = null;
  if (!batch) return;
  try {
    const result = await saveProgress(batch.orgId, batch.patch);
    if (!result.ok) throw new Error("The server refused the progress");
  } catch (error) {
    // Progress is a nicety: the next change sends everything again.
    console.error("[quests] not saved", error);
    pending ??= batch;
  }
}

/** The page is going away: sends what is waiting by beacon (falling back to a normal save). */
export function beaconProgress() {
  const batch = pending;
  if (!batch) return;
  clearTimeout(timer);
  if (typeof navigator.sendBeacon === "function") {
    const body = new Blob([JSON.stringify({ orgId: batch.orgId, patch: batch.patch })], { type: "application/json" });
    if (navigator.sendBeacon(BEACON_PATH, body)) {
      pending = null;
      return;
    }
  }
  void flushProgress();
}
