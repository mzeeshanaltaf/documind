"use client";

import dynamic from "next/dynamic";
import type { Player } from "@/lib/player";

// Client-only: WebGL, matchMedia and the settings mirror (CLAUDE.md › Hydration). three and R3F
// arrive as their own chunk; until then the panel shows its plain surface.
const OfficeDiorama = dynamic(() => import("@/game/world/diorama/OfficeDiorama"), { ssr: false });

export function DioramaBackdrop({ player }: { player: Pick<Player, "settings" | "updatedAt"> }) {
  return <OfficeDiorama player={player} />;
}
