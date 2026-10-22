import { toast } from "sonner";
import { savePlayer } from "@/app/(game)/actions";
import type { PlayerSettings } from "@/lib/player";
import { SETTINGS_MIRROR_KEY, type Settings } from "./settings";

/**
 * Settings persistence. Each change is mirrored to localStorage at once (instant boot on the next
 * load) and saved to the DB through `savePlayer`, debounced so a slider drag is one write.
 */
const DEBOUNCE_MS = 800;

let pending: PlayerSettings = {};
let timer: ReturnType<typeof setTimeout> | undefined;

function writeMirror(settings: Settings) {
  try {
    window.localStorage.setItem(SETTINGS_MIRROR_KEY, JSON.stringify({ settings, at: Date.now() }));
  } catch {
    // Storage can be full, blocked or unavailable (private mode); the DB save still happens.
  }
}

export function readMirror(): string | null {
  try {
    return window.localStorage.getItem(SETTINGS_MIRROR_KEY);
  } catch {
    return null;
  }
}

/** Queues the changed keys; `all` is the full settings object for the mirror. */
export function queueSettingsSave(changed: Partial<Settings>, all: Settings) {
  writeMirror(all);
  pending = { ...pending, ...changed };
  clearTimeout(timer);
  timer = setTimeout(() => void flushSettings(), DEBOUNCE_MS);
}

export async function flushSettings() {
  clearTimeout(timer);
  const settings = pending;
  pending = {};
  if (Object.keys(settings).length === 0) return;
  try {
    const result = await savePlayer({ settings });
    if (!result.ok) throw new Error(result.error);
  } catch (error) {
    console.error("[settings] save failed", error);
    toast.error("Your settings couldn't be saved. They'll apply on this device until you reload.");
  }
}
