import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { themeFor } from "@/content/room-themes";
import { box, cylinder, ico, Merged, type Part } from "../city/merge";
import { INK, useCanvasTexture } from "../city/signs";
import { type Floorplan, type Room, rectEdges } from "./floorplan";
import { OFFICE } from "./palette";
import { NOTICE, noticePainter } from "./signage";

/**
 * The rooms beyond the lobby as shells (phase O5): each department room has a desk, a shelf in
 * its accent and a notice on the far wall; the presentation room (O7) and the play area (O8) say
 * they're opening soon. O6 furnishes the department rooms and seats their experts.
 */
type Notice = { title: string; lines: string[]; accent: string };

function noticeFor(room: Room): Notice | null {
  if (room.kind === "department" && room.department) {
    const theme = themeFor(room.department);
    return { title: room.department, lines: [theme.blurb, "Questions for now? Reception can help."], accent: theme.accent };
  }
  if (room.kind === "presentation") return { title: "Presentation room", lines: ["Talks about the company,", "opening soon."], accent: INK.green };
  if (room.kind === "play") return { title: "Play area", lines: ["Games and a leaderboard,", "opening soon."], accent: INK.green };
  return null;
}

/** The far wall (away from the room's door): where the notice and the desk go. */
function farWall(room: Room): { x: number; z: number; yaw: number } {
  const { x0, x1 } = rectEdges(room.rect);
  const west = room.kind === "presentation" || room.side === "west";
  return west ? { x: x0 + 0.12, z: room.rect.z, yaw: Math.PI / 2 } : { x: x1 - 0.12, z: room.rect.z, yaw: -Math.PI / 2 };
}

function furnitureParts(rooms: Room[]): Part[] {
  const parts: Part[] = [];
  for (const room of rooms) {
    if (room.kind !== "department") continue;
    const wall = farWall(room);
    const inward = wall.yaw > 0 ? 1 : -1;
    const accent = themeFor(room.department ?? "").accent;
    const dx = (d: number) => wall.x + inward * d;
    // A desk 1.6 m off the far wall, a chair behind it, a low shelf and a plant.
    parts.push({ color: OFFICE.wood, geometry: box(0.8, 0.05, 1.6, { at: [dx(1.9), 0.76, wall.z + 1.2] }) });
    for (const [a, b] of [[-0.35, -0.72], [0.35, -0.72], [-0.35, 0.72], [0.35, 0.72]]) {
      parts.push({ color: OFFICE.dark, geometry: box(0.05, 0.74, 0.05, { at: [dx(1.9 + a), 0.37, wall.z + 1.2 + b] }) });
    }
    parts.push({ color: OFFICE.dark, geometry: box(0.5, 0.08, 0.5, { at: [dx(1.2), 0.46, wall.z + 1.2] }) });
    parts.push({ color: OFFICE.dark, geometry: box(0.06, 0.5, 0.5, { at: [dx(0.97), 0.75, wall.z + 1.2] }) });
    parts.push({ color: accent, geometry: box(0.4, 0.9, 2.2, { at: [dx(0.22), 0.45, wall.z - 2.2] }) });
    parts.push({ color: OFFICE.pot, geometry: cylinder(0.2, 0.16, 0.4, 7, { at: [dx(0.45), 0.2, wall.z + 3.1] }) });
    parts.push({ color: OFFICE.plant, geometry: ico(0.38, 0, { at: [dx(0.45), 0.8, wall.z + 3.1], scale: [1, 1.3, 1] }) });
  }
  return parts;
}

export function Rooms({ plan, version }: { plan: Floorplan; version: string }) {
  return (
    <>
      <Merged build={() => furnitureParts(plan.rooms)} version={version} />
      <RigidBody type="fixed" colliders={false} userData={{ surface: "wood" }}>
        {plan.rooms
          .filter((room) => room.kind === "department")
          .map((room) => {
            const wall = farWall(room);
            const inward = wall.yaw > 0 ? 1 : -1;
            return (
              <group key={room.id}>
                <CuboidCollider args={[0.4, 0.4, 0.8]} position={[wall.x + inward * 1.9, 0.4, wall.z + 1.2]} />
                <CuboidCollider args={[0.2, 0.45, 1.1]} position={[wall.x + inward * 0.22, 0.45, wall.z - 2.2]} />
              </group>
            );
          })}
      </RigidBody>
      {plan.rooms.map((room) => {
        const notice = noticeFor(room);
        return notice ? <RoomNotice key={room.id} room={room} notice={notice} /> : null;
      })}
    </>
  );
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
