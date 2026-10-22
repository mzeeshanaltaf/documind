"use client";

import { useEffect, useRef, useState } from "react";
import { meetsRequirement } from "@/game/interact/select";
import { rig } from "@/game/player/rig";
import { bus } from "@/game/quests/bus";
import { useGame } from "@/game/store/game-store";
import { type Floorplan, rectEdges } from "@/game/world/office/floorplan";
import { useFloorplan } from "@/game/world/office/use-floorplan";
import { cn } from "@/lib/utils";

/**
 * The office minimap, bottom right (phase O5 › Minimap): room outlines from the floor plan, the
 * NPCs, a lock on every room the player has no card for, and the player's arrow (moved by a
 * frame loop, not React). M toggles between small and large. Only inside the office.
 */
export function Minimap() {
  const inOffice = useGame((s) => s.world.scene === "office");
  if (!inOffice) return null;
  return <OfficeMap />;
}

const PAD = 1.5;

function OfficeMap() {
  const plan = useFloorplan();
  const cards = useGame((s) => s.player.cards);
  const [large, setLarge] = useState(false);
  const arrow = useRef<SVGGElement>(null);

  useEffect(() => bus.on("hotkey", (event) => event.action === "map" && setLarge((value) => !value)), []);

  // The player's arrow follows the rig every frame, without re-rendering the map.
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      arrow.current?.setAttribute(
        "transform",
        `translate(${rig.position.x.toFixed(2)} ${rig.position.z.toFixed(2)}) rotate(${((-rig.facing * 180) / Math.PI).toFixed(1)})`,
      );
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const { x0, x1, z0, z1 } = rectEdges(plan.bounds);
  const viewBox = `${x0 - PAD} ${z0 - PAD} ${x1 - x0 + PAD * 2} ${z1 - z0 + PAD * 2}`;
  const locked = (roomId: string) => {
    const door = plan.doors.find((d) => d.to === roomId && d.kind === "department");
    return door?.requires !== undefined && !meetsRequirement(cards, door.requires);
  };

  return (
    <figure
      aria-label="Office map"
      className={cn(
        "pointer-events-auto overflow-hidden rounded-lg bg-background/92 p-1.5 shadow-sm ring-1 ring-foreground/10 transition-[width] duration-200",
        large ? "w-[min(26rem,calc(100vw-2rem))]" : "w-40 max-sm:w-28",
      )}
    >
      <button
        type="button"
        onClick={() => setLarge((value) => !value)}
        aria-label={large ? "Make the map smaller (M)" : "Make the map larger (M)"}
        aria-pressed={large}
        className="block w-full rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <svg viewBox={viewBox} className="block h-auto w-full" role="img" aria-hidden>
          <MapRooms plan={plan} locked={locked} large={large} />
          {Object.entries(plan.npcSpots)
            .filter(([id]) => id === "reception")
            .map(([id, spot]) => (
              <circle key={id} cx={spot.position[0]} cy={spot.position[2]} r={0.7} className="fill-info" />
            ))}
          <g ref={arrow}>
            <path d="M0 1.6 L1.1 -1 L0 -0.45 L-1.1 -1 Z" className="fill-primary stroke-background" strokeWidth={0.3} />
          </g>
        </svg>
      </button>
    </figure>
  );
}

function MapRooms({ plan, locked, large }: { plan: Floorplan; locked: (roomId: string) => boolean; large: boolean }) {
  return (
    <>
      {plan.rooms.map((room) => {
        const { x0, z0 } = rectEdges(room.rect);
        const isLocked = room.kind === "department" && locked(room.id);
        return (
          <g key={room.id}>
            <rect
              x={x0}
              y={z0}
              width={room.rect.w}
              height={room.rect.d}
              className={cn("stroke-foreground/45", room.kind === "lobby" ? "fill-accent" : "fill-muted")}
              strokeWidth={0.25}
            />
            {isLocked && <LockGlyph x={room.rect.x} y={room.rect.z} />}
            {large && room.kind !== "corridor" && (
              <text
                x={room.rect.x}
                y={room.rect.z + (isLocked ? 2.6 : 0.5)}
                textAnchor="middle"
                className="fill-muted-foreground"
                style={{ fontSize: 1.3, fontFamily: "var(--font-instrument-sans), system-ui, sans-serif" }}
              >
                {room.kind === "department" ? room.name : room.name.replace(" room", "")}
              </text>
            )}
          </g>
        );
      })}
      {plan.doors
        .filter((door) => door.kind !== "street")
        .map((door) => {
          const half = door.width / 2;
          return door.orient === "h" ? (
            <line key={door.id} x1={door.x - half} x2={door.x + half} y1={door.z} y2={door.z} className="stroke-background" strokeWidth={0.5} />
          ) : (
            <line key={door.id} x1={door.x} x2={door.x} y1={door.z - half} y2={door.z + half} className="stroke-background" strokeWidth={0.5} />
          );
        })}
    </>
  );
}

/** A small padlock drawn in metres, centred on (x, y). */
function LockGlyph({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} className="fill-muted-foreground stroke-muted-foreground">
      <path d="M-0.55 -0.2 V-0.65 A0.55 0.55 0 0 1 0.55 -0.65 V-0.2" fill="none" strokeWidth={0.22} />
      <rect x={-0.85} y={-0.25} width={1.7} height={1.3} rx={0.2} stroke="none" />
    </g>
  );
}
