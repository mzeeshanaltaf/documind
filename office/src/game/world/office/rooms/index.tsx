import { useMemo } from "react";
import { expertFor } from "@/content/personas";
import { themeFor } from "@/content/room-themes";
import { useGame } from "@/game/store/game-store";
import { INK, useCanvasTexture } from "../../city/signs";
import { SAMPLE_CITY } from "../../city/sample";
import { type Floorplan, type Room, rectEdges } from "../floorplan";
import { NOTICE, noticePainter } from "../signage";
import { DepartmentRoom } from "./DepartmentRoom";

/**
 * The rooms beyond the lobby: a furnished department room with its expert per department
 * (phase O6), and a notice in the play area until it opens (O8). The presentation room is its own
 * module (`../presentation`, O7).
 */
export function Rooms({ plan }: { plan: Floorplan }) {
  const orgSlug = useGame((s) => s.office?.org.slug ?? "");
  const place = useGame((s) => s.office?.place) ?? SAMPLE_CITY;
  const departments = useMemo(
    () =>
      plan.rooms
        .filter((room) => room.kind === "department" && room.department)
        .map((room) => ({ room, theme: themeFor(room.department!), persona: expertFor(orgSlug, place, room.department!) })),
    [plan, orgSlug, place],
  );

  return (
    <>
      {departments.map(({ room, theme, persona }) => (
        <DepartmentRoom key={room.id} room={room} theme={theme} persona={persona} plan={plan} spot={plan.npcSpots[persona.id]} />
      ))}
      {plan.rooms.map((room) => {
        const notice = noticeFor(room);
        return notice ? <RoomNotice key={room.id} room={room} notice={notice} /> : null;
      })}
    </>
  );
}

type Notice = { title: string; lines: string[]; accent: string };

function noticeFor(room: Room): Notice | null {
  if (room.kind === "play") return { title: "Play area", lines: ["Games and a leaderboard,", "opening soon."], accent: INK.green };
  return null;
}

/** The far wall of the play area (away from its door on the lobby). */
function farWall(room: Room): { x: number; z: number; yaw: number } {
  const { x1 } = rectEdges(room.rect);
  return { x: x1 - 0.12, z: room.rect.z, yaw: -Math.PI / 2 };
}

function RoomNotice({ room, notice }: { room: Room; notice: Notice }) {
  const texture = useCanvasTexture(NOTICE.width, NOTICE.height, noticePainter(notice.title, notice.lines, notice.accent), `${notice.title}|${notice.lines.join("|")}`);
  const wall = farWall(room);
  return (
    <mesh position={[wall.x, 1.75, wall.z]} rotation={[0, wall.yaw, 0]}>
      <planeGeometry args={[2, 1.25]} />
      <meshStandardMaterial map={texture} roughness={0.8} />
    </mesh>
  );
}
