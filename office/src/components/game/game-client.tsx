"use client";

import dynamic from "next/dynamic";
import type { GameEntry } from "@/game/init";
import { GameBootScreen } from "./game-boot-screen";

// Client-only: the game reads WebGL, window and localStorage while initializing (CLAUDE.md ›
// Hydration). Its JS (three, R3F, rapier) loads as a separate chunk behind this boundary.
const GameRoot = dynamic(() => import("@/game/GameRoot"), { ssr: false, loading: () => <GameBootScreen /> });

export function GameClient(entry: GameEntry) {
  return <GameRoot {...entry} />;
}
