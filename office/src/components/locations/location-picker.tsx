"use client";

import { ArrowRightIcon, GlobeIcon, MoonIcon, SunIcon } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LogoMark } from "@/components/brand/logo";
import { ButtonLink } from "@/components/button-link";
import { OrgAvatar } from "@/components/home/org-avatar";
import { buttonVariants } from "@/components/ui/button";
import { previewMotion } from "@/game/engine/preview";
import { FLY_MS, useGlobe } from "@/game/world/globe/globe-store";
import { formatLocalTime, formatUtcOffset, isDaytime } from "@/lib/format";
import { type Location, WORLDWIDE_ID } from "@/lib/locations";
import type { Player } from "@/lib/player";
import { cn } from "@/lib/utils";

// Client-only: WebGL, matchMedia and the settings mirror (CLAUDE.md › Hydration). The list
// below is server-rendered and works on its own while the globe's chunk loads, or without it.
const GlobeCanvas = dynamic(() => import("@/game/world/globe/GlobeCanvas"), { ssr: false });

/** With reduced motion (or no globe) a choice fades the page instead of flying the camera. */
const FADE_MS = 200;
const TICK_MS = 30_000;

export type LocationPickerProps = {
  org: { id: string; name: string; slug: string; logo: string | null };
  locations: Location[];
  /** English country names by code, resolved on the server so both renders agree. */
  countries: Record<string, string>;
  /** The last visit in this org, if that location still exists. */
  resumeId: string | null;
  player: Pick<Player, "settings" | "updatedAt">;
  /** The server's clock when it rendered, so the server and the first client render match. */
  renderedAt: number;
};

/**
 * `/[orgSlug]`: the globe beside the list of offices. Choosing one (a list row, a pin, its
 * label, the Worldwide ring or "Resume") flies the camera to it, or fades with reduced motion,
 * then opens `/[orgSlug]/[location]`. The list is the primary path for keyboard and screen
 * readers; every row is a real link, so it works before the script has loaded too.
 */
export function LocationPicker({ org, locations, countries, resumeId, player, renderedAt }: LocationPickerProps) {
  const router = useRouter();
  const [now, setNow] = useState(renderedAt);
  const [flying, setFlying] = useState(false);
  // The curtain follows the globe's choice. Next keeps a visited route mounted but hidden
  // (Activity) and the effect below resets the store when it shows again (Menu › Change
  // location), so a stale "Opening the office" from the last choice goes away with it.
  const chosen = useGlobe((s) => s.selected !== null);
  const leaving = chosen ? { fly: flying } : null;
  const timer = useRef<number | undefined>(undefined);
  const byId = useMemo(() => new Map(locations.map((location) => [location.id, location])), [locations]);
  const resume = resumeId ? byId.get(resumeId) : undefined;
  const offices = locations.filter((location) => location.id !== WORLDWIDE_ID);
  const worldwide = byId.get(WORLDWIDE_ID);

  // The clock: every 30 s, first catching up if this render came from an older payload.
  useEffect(() => {
    useGlobe.getState().reset(renderedAt);
    const tick = () => {
      const time = Date.now();
      setNow(time);
      useGlobe.getState().tick(time);
    };
    let interval: number | undefined;
    const first = window.setTimeout(
      () => {
        tick();
        interval = window.setInterval(tick, TICK_MS);
      },
      Math.max(0, TICK_MS - (Date.now() - renderedAt)),
    );
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
      window.clearTimeout(timer.current);
    };
  }, [renderedAt]);

  const choose = useCallback(
    (id: string) => {
      const globe = useGlobe.getState();
      if (!byId.has(id) || globe.selected) return;
      const href = `/${org.slug}/${id}`;
      const fly = !previewMotion(player).reduced && globe.ready;
      globe.select(id);
      setFlying(fly);
      router.prefetch(href);
      timer.current = window.setTimeout(() => router.push(href), fly ? FLY_MS : FADE_MS);
    },
    [byId, org.slug, player, router],
  );

  /** Plain left clicks animate; modified clicks (new tab, new window) stay ordinary links. */
  const onLinkClick = (id: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    choose(id);
  };

  return (
    <div className="grid flex-1 lg:h-[calc(100svh-4rem)] lg:grid-cols-[minmax(0,1fr)_25rem] lg:overflow-hidden">
      <div aria-hidden className="relative h-[46svh] min-h-72 overflow-hidden lg:h-auto">
        <GlobeCanvas
          locations={locations}
          initialFocus={resumeId}
          player={player}
          onChoose={choose}
        />
        <p className="pointer-events-none absolute bottom-3 left-4 text-xs text-muted-foreground sm:left-6">
          <span className="pointer-coarse:hidden">Drag to turn the globe. Click a pin or the ring to go in.</span>
          <span className="hidden pointer-coarse:inline">Swipe to turn the globe. Tap a pin or the ring to go in.</span>
        </p>
      </div>

      <section
        aria-labelledby="offices-title"
        className="flex flex-col gap-6 border-t bg-sidebar px-4 py-8 sm:px-10 lg:overflow-y-auto lg:border-t-0 lg:border-l lg:px-7 lg:py-9"
      >
        <header className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <OrgAvatar name={org.name} logo={org.logo} className="size-6 text-[0.65rem]" />
              <span className="truncate text-sm font-medium">{org.name}</span>
            </span>
            <ButtonLink href="/?pick=1" variant="ghost" size="sm" className="-mr-2 shrink-0">
              Switch org
            </ButtonLink>
          </div>
          <h1 id="offices-title" className="font-heading text-[1.7rem] leading-tight font-semibold tracking-[-0.01em]">
            Choose an office
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Each office answers from its own country&apos;s policies and the company-wide ones. The Global Hub covers
            every country.
          </p>
        </header>

        {resume && (
          <Link
            href={`/${org.slug}/${resume.id}`}
            onClick={onLinkClick(resume.id)}
            onMouseEnter={() => useGlobe.getState().hover(resume.id, "list")}
            onMouseLeave={() => useGlobe.getState().hover(null, "list")}
            onFocus={() => useGlobe.getState().hover(resume.id, "list")}
            onBlur={() => useGlobe.getState().hover(null, "list")}
            className={cn(buttonVariants({ size: "lg" }), "w-full")}
          >
            Resume in {resume.name}
            <ArrowRightIcon data-icon="inline-end" />
          </Link>
        )}

        <ul aria-label="Offices" className="flex flex-col divide-y overflow-hidden rounded-lg border bg-background">
          {offices.map((location) => (
            <LocationRow
              key={location.id}
              location={location}
              href={`/${org.slug}/${location.id}`}
              country={location.country ? (countries[location.country] ?? location.country) : null}
              now={now}
              onClick={onLinkClick(location.id)}
            />
          ))}
          {worldwide && (
            <LocationRow
              location={worldwide}
              href={`/${org.slug}/${worldwide.id}`}
              country={null}
              now={now}
              onClick={onLinkClick(worldwide.id)}
            />
          )}
        </ul>
      </section>

      <div
        aria-hidden={!leaving}
        className={cn(
          "pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background opacity-0 transition-opacity ease-out-quart",
          leaving && "pointer-events-auto opacity-100",
          leaving?.fly ? "delay-[600ms] duration-300" : "duration-200",
        )}
      >
        {leaving && (
          <div role="status" className="flex flex-col items-center gap-5">
            <LogoMark className="size-10" />
            <p className="text-sm font-medium">Opening the office</p>
          </div>
        )}
      </div>
    </div>
  );
}

type LocationRowProps = {
  location: Location;
  href: string;
  country: string | null;
  now: number;
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
};

function LocationRow({ location, href, country, now, onClick }: LocationRowProps) {
  const active = useGlobe((s) => s.hovered === location.id);
  const hub = location.id === WORLDWIDE_ID;
  const placed = location.lat !== null && location.lon !== null;
  const day = location.lat !== null && location.lon !== null && isDaytime(now, location.lat, location.lon);
  const TimeIcon = day ? SunIcon : MoonIcon;
  const hover = (on: boolean) => useGlobe.getState().hover(on ? location.id : null, "list");

  const policies = hub
    ? `All ${location.docCodes.length} ${location.docCodes.length === 1 ? "policy" : "policies"}, every country`
    : location.docCodes.length > 0
      ? `Local policies: ${location.docCodes.join(", ")}`
      : "Local policies on file";

  return (
    <li>
      <Link
        href={href}
        prefetch={false}
        onClick={onClick}
        onMouseEnter={() => hover(true)}
        onMouseLeave={() => hover(false)}
        onFocus={() => hover(true)}
        onBlur={() => hover(false)}
        data-active={active || undefined}
        className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 px-4 py-3 transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset data-active:bg-muted"
      >
        <span className="flex min-w-0 items-center gap-2">
          {hub && <GlobeIcon aria-hidden className="size-4 shrink-0 self-center text-primary" />}
          <span className="truncate text-[0.9375rem] font-medium">{location.name}</span>
        </span>
        {placed ? (
          <span className="flex items-center gap-1.5 justify-self-end">
            <TimeIcon aria-hidden className="size-3.5 self-center text-muted-foreground" />
            <span className="font-mono text-[0.8125rem] tabular-nums">{formatLocalTime(now, location.timezone)}</span>
            <span className="sr-only">local time, {day ? "daytime" : "night"}</span>
          </span>
        ) : (
          <span />
        )}
        <span className="truncate text-sm text-muted-foreground">
          {hub ? "Worldwide" : [location.roleLabel, country].filter(Boolean).join(" · ")}
        </span>
        {placed ? (
          <span className="justify-self-end font-mono text-[0.7rem] text-muted-foreground tabular-nums">
            {formatUtcOffset(now, location.timezone)}
          </span>
        ) : (
          <span />
        )}
        <span className="col-span-2 mt-1 truncate font-mono text-[0.7rem] text-muted-foreground">{policies}</span>
      </Link>
    </li>
  );
}
