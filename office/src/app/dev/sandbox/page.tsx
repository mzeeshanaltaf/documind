import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getPlayer } from "@/app/(game)/actions";
import { GameBootScreen } from "@/components/game/game-boot-screen";
import { GameClient } from "@/components/game/game-client";
import { requireSession } from "@/lib/auth-guards";

export const metadata: Metadata = { title: "Sandbox" };

/**
 * The engine test room (phase O2), development only. It checks the session like every game page,
 * then hands the player to the client-only game.
 */
export default function SandboxPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Suspense fallback={<GameBootScreen />}>
      <Sandbox />
    </Suspense>
  );
}

async function Sandbox() {
  await requireSession();
  const player = await getPlayer();
  return (
    <GameClient
      player={player}
      scene="sandbox"
      spawn={{ position: [0, 0, 6], yaw: Math.PI }}
      location={{ org: "Development", city: "Sandbox", room: "Test room" }}
    />
  );
}
