import { lazy, Suspense, useEffect, useMemo, useRef } from "react";
import { audio } from "@/game/audio/audio";
import { TIERS } from "@/game/engine/quality";
import { emit } from "@/game/quests/bus";
import { selectTier, useGame } from "@/game/store/game-store";
import { OFFICE_SPAWNS } from "@/game/world/office/spawns";
import { countryName, type Location } from "@/lib/locations";
import { ambienceFor } from "./ambience";
import { OfficeBuilding } from "./building";
import { Buildings } from "./Buildings";
import { CitySky } from "./CitySky";
import { localHour } from "./lighting";
import { CITY, generateCity, groundHeight } from "./generator";
import { Colliders, Ground } from "./Ground";
import { LANDMARKS } from "./landmarks";
import { Pedestrians } from "./pedestrians";
import { SAMPLE_CITY } from "./sample";
import { StreetFurniture } from "./StreetFurniture";
import { Traffic } from "./traffic";
import { useCitySky } from "./use-city-sky";

const GlobalHub = lazy(() => import("./global-hub"));

/**
 * The street scene for the current office location (phase O4): a generated city block round
 * the org's tower, or the floating Global Hub for Worldwide. The dev sandbox's lift (no office
 * context) gets a sample city.
 */
export default function CityScene() {
  const place = useGame((s) => s.office?.place) ?? SAMPLE_CITY;
  if (place.landmarkKit === "global-hub") {
    return (
      <Suspense fallback={null}>
        <GlobalHub place={place} />
      </Suspense>
    );
  }
  return <City place={place} />;
}

/** Breadcrumb, the `city_entered` event and the place's sound, once per arrival on the street. */
export function useArrival(place: Location, isNight: boolean) {
  const night = useRef(isNight);
  useEffect(() => {
    night.current = isNight;
  });
  useEffect(() => {
    useGame.getState().setLocation({ room: null });
    // The local hour feeds "Early bird" (O9); the dev clock stands in for the real time, as in the sky.
    const { clockHour } = useGame.getState();
    emit({ type: "city_entered", location: place.id, isNight: night.current, hour: clockHour ?? localHour(Date.now(), place.timezone) });
    const sound = ambienceFor(place.landmarkKit);
    audio.loop("ambience", sound.ambience);
    audio.loop("music", sound.music);
    return () => {
      audio.loop("ambience", null);
      audio.loop("music", null);
    };
  }, [place]);
}

/** Through the doors: the office (the O5 lobby; a placeholder until then). */
export function enterOffice(place: Location) {
  audio.play("door-close", { volume: 0.4 });
  emit({ type: "office_entered", location: place.id });
  useGame.getState().transitionTo("office", OFFICE_SPAWNS.lobby_entrance);
}

function City({ place }: { place: Location }) {
  const layout = useMemo(() => generateCity(place), [place]);
  const sky = useCitySky(place);
  const tier = TIERS[useGame(selectTier)];
  const orgName = useGame((s) => s.office?.org.name) ?? "DocuMind";
  const Landmark = LANDMARKS[place.landmarkKit === "global-hub" ? "generic" : place.landmarkKit];
  useArrival(place, sky.isNight);

  return (
    <>
      <CitySky sky={sky} />
      <Ground layout={layout} />
      <Colliders colliders={layout.colliders} />
      <Buildings layout={layout} night={sky.night} />
      <StreetFurniture furniture={layout.furniture} night={sky.night} shadows={tier.shadows} />
      <OfficeBuilding
        site={layout.office}
        entrance={layout.entrance}
        base={CITY.curb}
        orgName={orgName}
        placeName={place.name}
        night={sky.night}
        onEnter={() => enterOffice(place)}
      />
      <Landmark
        site={layout.landmark}
        vista={layout.vista}
        garden={layout.garden}
        curb={CITY.curb}
        night={sky.night}
        accent={place.palette.accent}
        placeName={place.name}
        countryName={place.country ? countryName(place.country) : ""}
      />
      <Traffic layout={layout} count={tier.maxCars} shadows={tier.shadows} />
      <Pedestrians graph={layout.walk} count={tier.maxNpcs} seed={layout.seed} groundAt={groundHeight} />
    </>
  );
}
