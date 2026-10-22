import { useEffect, useMemo, useState } from "react";
import { useGame } from "@/game/store/game-store";
import type { Location } from "@/lib/locations";
import { atLocalHour, localHour, type SkyState, skyAt } from "./lighting";

const MINUTE = 60_000;

/**
 * Where to put the sun for a place with no coordinates (a country missing from the defaults):
 * the latitude of a temperate city, and the longitude its time zone implies.
 */
function coordinates(place: Location, at: number): [number, number] {
  if (place.lat !== null && place.lon !== null) return [place.lat, place.lon];
  const utc = new Date(at).getUTCHours() + new Date(at).getUTCMinutes() / 60;
  let offset = localHour(at, place.timezone) - utc;
  if (offset > 12) offset -= 24;
  if (offset < -12) offset += 24;
  return [35, offset * 15];
}

/**
 * The sky over a place at its real local time, recomputed every minute; in development the Esc
 * menu's clock (`clockHour`) can set the local hour instead. Publishes the phase to the store.
 */
export function useCitySky(place: Location): SkyState {
  const clockHour = useGame((s) => s.clockHour);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), MINUTE);
    return () => window.clearInterval(timer);
  }, []);

  const sky = useMemo(() => {
    const at = clockHour === null ? now : atLocalHour(now, place.timezone, clockHour).getTime();
    const [lat, lon] = coordinates(place, at);
    return skyAt(at, lat, lon);
  }, [now, clockHour, place]);

  useEffect(() => {
    useGame.getState().setSky({ phase: sky.phase, isNight: sky.isNight });
  }, [sky.phase, sky.isNight]);
  useEffect(() => () => useGame.getState().setSky(null), []);
  return sky;
}
