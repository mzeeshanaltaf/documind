import { MoonIcon, SunIcon } from "lucide-react";
import { formatLocalTime, isDaytime } from "@/lib/format";
import type { Location } from "@/lib/locations";
import { useGlobe } from "./globe-store";
import { labelElements } from "./labels";

type PinnedLocation = Location & { lat: number; lon: number };

/**
 * The label cards next to the pins: city, role, live local time and a day/night mark. They're a
 * pointer convenience (click one to choose it); the list beside the globe is the accessible path,
 * so the layer is hidden from assistive tech and out of the tab order. The rig places them.
 */
export function GlobeLabels({ locations, onChoose }: { locations: PinnedLocation[]; onChoose: (id: string) => void }) {
  const now = useGlobe((s) => s.now);
  const hovered = useGlobe((s) => s.hovered);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {locations.map((location) => {
        const day = isDaytime(now, location.lat, location.lon);
        const Icon = day ? SunIcon : MoonIcon;
        return (
          <button
            key={location.id}
            type="button"
            tabIndex={-1}
            ref={(element) => {
              if (!element) return;
              labelElements.set(location.id, element);
              return () => {
                labelElements.delete(location.id);
              };
            }}
            onPointerEnter={() => useGlobe.getState().hover(location.id, "globe")}
            onPointerLeave={() => useGlobe.getState().hover(null, "globe")}
            onClick={() => onChoose(location.id)}
            data-active={hovered === location.id || undefined}
            style={{ opacity: 0, visibility: "hidden" }}
            className="pointer-events-auto absolute top-0 left-0 flex cursor-pointer flex-col items-start gap-0.5 rounded-md bg-background/94 px-2 py-1 text-left whitespace-nowrap shadow-sm ring-1 ring-foreground/10 transition-[box-shadow] duration-150 will-change-transform data-active:ring-2 data-active:ring-primary/70"
          >
            <span className="text-[0.8125rem] leading-tight font-medium">{location.name}</span>
            <span className="flex items-center gap-1 text-[0.6875rem] leading-tight text-muted-foreground">
              {location.roleLabel}
              <span aria-hidden>·</span>
              <span className="font-mono tabular-nums">{formatLocalTime(now, location.timezone)}</span>
              <Icon className="size-3" />
            </span>
          </button>
        );
      })}
    </div>
  );
}
