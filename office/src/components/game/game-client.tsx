"use client";

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";
import type { GameEntry } from "@/game/init";
import { webglSupport } from "@/game/webgl";
import { GameBootScreen } from "./game-boot-screen";
import { NoWebgl } from "./no-webgl";

// Client-only: the game reads WebGL, window and localStorage while initializing (CLAUDE.md ›
// Hydration). Its JS (three, R3F, rapier) loads as a separate chunk behind this boundary.
const GameRoot = dynamic(() => import("@/game/GameRoot"), { ssr: false, loading: () => <GameBootScreen /> });

export function GameClient(entry: GameEntry) {
  const support = useSyncExternalStore(webglSupport.subscribe, webglSupport.getSnapshot, webglSupport.getServerSnapshot);
  if (support === "unknown") return <GameBootScreen />;
  if (support === "no") return <NoWebgl office={entry.office} />;
  return <GameRoot {...entry} />;
}
