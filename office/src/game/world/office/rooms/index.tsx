import { useMemo } from "react";
import { expertFor } from "@/content/personas";
import { themeFor } from "@/content/room-themes";
import { useGame } from "@/game/store/game-store";
import { SAMPLE_CITY } from "../../city/sample";
import type { Floorplan } from "../floorplan";
import { DepartmentRoom } from "./DepartmentRoom";

/**
 * The department rooms beyond the lobby: a furnished room with its expert per department
 * (phase O6). The presentation room (`../presentation`, O7) and the play area (`../play`, O8) are
 * their own modules.
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
    </>
  );
}
