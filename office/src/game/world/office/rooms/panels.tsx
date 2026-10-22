import { useEffect, useMemo, useState } from "react";
import { formatUtcOffset, pageLabel } from "@/lib/format";
import type { Location } from "@/lib/locations";
import { useGame } from "@/game/store/game-store";
import { type Painter, useCanvasTexture } from "../../city/signs";
import { loadEarthMask } from "../../globe/earth-mask";
import type { Floorplan } from "../floorplan";
import type { Panel } from "./decor";
import {
  BLUEPRINT,
  blueprintPainter,
  CALENDAR,
  calendarPainter,
  CHART,
  chartPainter,
  CLOCK_LABEL,
  clockLabelsPainter,
  itPosterPainter,
  MAP,
  type Mask,
  mapPainter,
  PEOPLE,
  peoplePainter,
  POSTER,
  RECYCLING,
  recyclingPainter,
  SCREEN,
  type ScreenContent,
  screenPainter,
  speakUpPainter,
  WHITEBOARD,
  whiteboardPainter,
} from "./textures";

/**
 * The painted panels of a department room (decor.ts places them, textures.ts paints them), and
 * the wall screen, which shows the room's department until one of this expert's citations is
 * open in the viewer, then that document and its page.
 */
export type PanelContext = {
  department: string;
  accent: string;
  /** The expert's first name. */
  expert: string;
  blurb: string;
  npc: string;
  plan: Floorplan;
  city: string;
  offices: Location[];
};

type Spec = { width: number; height: number; paint: Painter; key: string; transparent?: boolean; glow?: boolean };

function monthName(): string {
  return new Intl.DateTimeFormat("en-GB", { month: "long" }).format(new Date());
}

function staticSpec(panel: Panel, context: PanelContext, mask: Mask | null): Spec | null {
  const { department, accent, expert, plan, city, offices } = context;
  switch (panel.id) {
    case "people":
      return { ...PEOPLE, paint: peoplePainter, key: "people", transparent: true };
    case "calendar": {
      const month = monthName();
      return { ...CALENDAR, paint: calendarPainter(month, accent), key: `${month}|${accent}` };
    }
    case "poster-it":
      return { ...POSTER, paint: itPosterPainter, key: "it" };
    case "chart-bars":
    case "chart-line":
      return { ...CHART, paint: chartPainter(panel.id === "chart-bars" ? "bars" : "line"), key: panel.id, glow: true };
    case "blueprint": {
      const rooms = plan.rooms.map((room) => ({ rect: room.rect, name: room.name }));
      return { ...BLUEPRINT, paint: blueprintPainter(rooms, city), key: `${city}|${rooms.length}` };
    }
    case "recycling":
      return { ...RECYCLING, paint: recyclingPainter, key: "recycling" };
    case "poster-speakup":
      return { ...POSTER, paint: speakUpPainter(expert), key: expert };
    case "map": {
      const pins = offices.flatMap((o) => (o.lat !== null && o.lon !== null ? [{ name: o.name, lat: o.lat, lon: o.lon, hq: o.role === "hq" }] : []));
      return { ...MAP, paint: mapPainter(mask, pins), key: `${mask ? "mask" : "plain"}|${pins.map((p) => p.name).join(",")}` };
    }
    case "clock-labels": {
      const now = Date.now();
      const labels = clockOffices(offices).map((o) => ({ city: o.name, offset: formatUtcOffset(now, o.timezone) }));
      return {
        width: CLOCK_LABEL.perClock * Math.max(1, labels.length),
        height: CLOCK_LABEL.height,
        paint: clockLabelsPainter(labels),
        key: labels.map((l) => `${l.city}${l.offset}`).join(","),
        transparent: true,
      };
    }
    case "whiteboard":
      return { ...WHITEBOARD, paint: whiteboardPainter(department), key: department };
    default:
      return null;
  }
}

/** The offices that get a clock: the org's cities (not Worldwide), at most six. */
export function clockOffices(offices: Location[]): Location[] {
  return offices.filter((o) => o.role !== "hub").slice(0, 6);
}

/** The land mask for the International room's map (loaded once per page; null until then). */
function useMask(needed: boolean): Mask | null {
  const [mask, setMask] = useState<Mask | null>(null);
  useEffect(() => {
    if (!needed) return;
    let live = true;
    void loadEarthMask().then((loaded) => live && setMask(loaded));
    return () => {
      live = false;
    };
  }, [needed]);
  return mask;
}

export function RoomPanels({ panels, context }: { panels: Panel[]; context: PanelContext }) {
  const mask = useMask(panels.some((panel) => panel.id === "map"));
  return panels.map((panel) =>
    panel.id === "screen" ? (
      <WallScreen key={panel.id} panel={panel} context={context} />
    ) : (
      <StaticPanel key={panel.id} panel={panel} context={context} mask={mask} />
    ),
  );
}

function StaticPanel({ panel, context, mask }: { panel: Panel; context: PanelContext; mask: Mask | null }) {
  const spec = staticSpec(panel, context, mask);
  if (!spec) return null;
  return <PaintedPlane panel={panel} spec={spec} />;
}

function PaintedPlane({ panel, spec }: { panel: Panel; spec: Spec }) {
  const texture = useCanvasTexture(spec.width, spec.height, spec.paint, spec.key);
  return (
    <mesh position={panel.at} rotation={[0, panel.yaw, 0]}>
      <planeGeometry args={panel.size} />
      {spec.glow ? (
        <meshBasicMaterial map={texture} toneMapped={false} transparent={spec.transparent} alphaTest={spec.transparent ? 0.05 : 0} />
      ) : (
        <meshStandardMaterial map={texture} roughness={0.85} transparent={spec.transparent} alphaTest={spec.transparent ? 0.05 : 0} />
      )}
    </mesh>
  );
}

/** What the room's screen shows: the open citation from this expert, else the department. */
export function screenContent(context: Pick<PanelContext, "department" | "accent" | "expert" | "blurb">, open: { docCode: string | null; title: string; page: number | null; pageEnd: number | null } | null): ScreenContent {
  if (open) return { kind: "document", docCode: open.docCode, title: open.title, page: pageLabel(open.page, open.pageEnd) || "Document", accent: context.accent };
  return { kind: "room", department: context.department, expert: context.expert, blurb: context.blurb, accent: context.accent };
}

function WallScreen({ panel, context }: { panel: Panel; context: PanelContext }) {
  const open = useGame((s) => (s.viewer.open && s.viewer.request?.npc === context.npc ? s.viewer.request : null));
  const content = useMemo(() => screenContent(context, open), [context, open]);
  const key = content.kind === "room" ? `room|${content.department}|${content.expert}` : `doc|${content.docCode}|${content.title}|${content.page}`;
  return (
    <group userData={{ screen: content.kind }}>
      <PaintedPlane panel={panel} spec={{ ...SCREEN, paint: screenPainter(content), key, glow: true }} />
    </group>
  );
}
