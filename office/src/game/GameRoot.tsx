"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Hud } from "@/components/hud/hud";
import type { Player } from "@/lib/player";
import { startAnalytics } from "./analytics";
import { audio } from "./audio/audio";
import { GameCanvas, renderer } from "./engine/GameCanvas";
import { Loading } from "./engine/Loading";
import { type GameEntry, initGame } from "./init";
import { useKeyboardInput } from "./input/use-keyboard";
import { flushSettings, queueSettingsSave } from "./persist";
import { isFirstLook } from "./player/avatar-style";
import { rig } from "./player/rig";
import { startStats } from "./progress/stats";
import { bus, type GameEvent } from "./quests/bus";
import { startQuests } from "./quests/runtime";
import { changedSettings } from "./settings";
import { selectReducedMotion, useGame } from "./store/game-store";

/**
 * The game's client root, loaded with `ssr: false`: everything below uses WebGL, window and
 * localStorage from the first render. Mounted by a Server Component page that has already
 * checked access and loaded the player.
 */
export default function GameRoot(entry: GameEntry) {
  // Before the first render of anything that reads the store.
  useState(() => initGame(entry));
  useReinitOnReveal(entry);

  useKeyboardInput();
  useMotionPreference();
  useAudio();
  useSettingsPersistence();
  useEffect(startStats, []);
  useEffect(startQuests, []);
  useEffect(startAnalytics, []);
  useFirstLook(entry.player);
  useDevHandle();

  return (
    <div className="fixed inset-0 overflow-hidden bg-background">
      <h1 className="sr-only">DocuMind Office</h1>
      <GameCanvas />
      <Hud />
      <Loading />
    </div>
  );
}

/**
 * Next keeps a visited route mounted but hidden (Activity) and shows it again on a later visit
 * (Back, or picking the same office again) with its state intact. The store is a module
 * singleton that another visit has since reset, so a shown-again game starts over from its own
 * entry. Layout effects re-run on every show; the first mount already initialized in render.
 */
function useReinitOnReveal(entry: GameEntry) {
  const shown = useRef(false);
  const latest = useRef(entry);
  useLayoutEffect(() => {
    latest.current = entry;
  });
  // Mount and show only: a re-render with new props must not restart a game in progress.
  useLayoutEffect(() => {
    if (shown.current) initGame(latest.current);
    shown.current = true;
  }, []);
}

/** Follows the OS setting, and marks the document so CSS motion stops when motion is reduced. */
function useMotionPreference() {
  const reduced = useGame(selectReducedMotion);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => useGame.getState().setOsReducedMotion(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (reduced) root.dataset.motion = "reduced";
    else delete root.dataset.motion;
    return () => {
      delete root.dataset.motion;
    };
  }, [reduced]);
}

/** Unlocks audio on the first gesture (browsers require one) and keeps the bus volumes in sync. */
function useAudio() {
  const sound = useGame((s) => s.settings.sound_volume);
  const music = useGame((s) => s.settings.music_volume);

  useEffect(() => {
    audio.setVolumes({ sound, music });
  }, [sound, music]);

  useEffect(() => {
    const stop = () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    };
    const unlock = () => {
      audio.unlock();
      stop();
    };
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("keydown", unlock, true);
    return stop;
  }, []);
}

/** Saves changed settings (mirror now, DB debounced) and flushes on leaving the page. */
function useSettingsPersistence() {
  useEffect(() => {
    const unsubscribe = useGame.subscribe((state, previous) => {
      if (state.settings === previous.settings) return;
      const changed = changedSettings(state.settings, previous.settings);
      if (Object.keys(changed).length > 0) queueSettingsSave(changed, state.settings);
    });
    const onPageHide = () => void flushSettings();
    window.addEventListener("pagehide", onPageHide);
    return () => {
      unsubscribe();
      window.removeEventListener("pagehide", onPageHide);
      void flushSettings();
    };
  }, []);
}

/** A player who has never saved a look gets the editor once the first scene is in view. */
function useFirstLook(player: Player) {
  useEffect(() => {
    if (!isFirstLook(player.avatar)) return;
    let shown = false;
    return useGame.subscribe((state) => {
      if (shown || state.world.phase !== "ready" || state.modal) return;
      shown = true;
      state.openModal({ type: "avatar", first: true });
    });
  }, [player.avatar]);
}

declare global {
  interface Window {
    /** Development only: the store and renderer stats, for Playwright and the console. */
    __office?: {
      getState: typeof useGame.getState;
      setState: typeof useGame.setState;
      memory: () => { geometries: number; textures: number } | null;
      render: () => { calls: number; triangles: number; pixelRatio: number; shadows: boolean; exposure: number } | null;
      /** The camera orbit and the player's feet (screenshots aim the camera through it). */
      rig: typeof rig;
      /** Every bus event since the game mounted (the last 200), oldest first. */
      events: GameEvent[];
    };
  }
}

function useDevHandle() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const events: GameEvent[] = [];
    const unsubscribe = bus.onAny((event) => {
      events.push(event);
      if (events.length > 200) events.shift();
    });
    window.__office = {
      events,
      getState: useGame.getState,
      setState: useGame.setState,
      memory: () => (renderer.gl ? { ...renderer.gl.info.memory } : null),
      render: () => {
        const gl = renderer.gl;
        if (!gl) return null;
        const { calls, triangles } = gl.info.render;
        return { calls, triangles, pixelRatio: gl.getPixelRatio(), shadows: gl.shadowMap.enabled, exposure: gl.toneMappingExposure };
      },
      rig,
    };
    return () => {
      unsubscribe();
      delete window.__office;
    };
  }, []);
}
