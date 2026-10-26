import { SIMTORA_LANDMARKS } from "@/content/orgs/simtora";
import type { LandmarkKit, Location } from "@/lib/locations";

/**
 * What the rooftop telescope shows (phase O9 › Rooftop): the landmark's name and a fun fact, as
 * static text. An org's own text (per location id) wins; otherwise the landmark kit's. The city
 * scenes' landmark is the same one, so the telescope looks at what you can walk up to below.
 */
export type LandmarkInfo = { name: string; fact: string };

const ORG_LANDMARKS: Record<string, Record<string, LandmarkInfo>> = { simtora: SIMTORA_LANDMARKS };

const KIT_LANDMARKS: Record<Exclude<LandmarkKit, "generic" | "global-hub">, LandmarkInfo> = {
  "golden-gate": {
    name: "Golden Gate Bridge",
    fact: "It opened in 1937 and was the longest suspension bridge in the world for 27 years. Its colour, International Orange, was picked so it stays visible in the fog.",
  },
  minar: {
    name: "Minar-e-Pakistan",
    fact: "It stands in Iqbal Park, where the Lahore Resolution was adopted in March 1940. The tower took from 1960 to 1968 to build.",
  },
  brandenburg: {
    name: "Brandenburg Gate",
    fact: "It was finished in 1791. The Quadriga on top, a chariot with four horses, was carried off to Paris in 1806 and came home in 1814.",
  },
  eiffel: {
    name: "Eiffel Tower",
    fact: "It was built for the 1889 World's Fair and was meant to stand for 20 years. On a hot summer day it is about 15 cm taller.",
  },
  "opera-house": {
    name: "Sydney Opera House",
    fact: "It opened in 1973. Its white sails are covered in more than a million self-cleaning tiles.",
  },
  "elizabeth-tower": {
    name: "Elizabeth Tower",
    fact: "It holds the Great Bell, known as Big Ben: the name belongs to the bell, not the tower. The tower was renamed in 2012 for the Queen's Diamond Jubilee.",
  },
};

export function landmarkInfo(orgSlug: string, place: Pick<Location, "id" | "name" | "landmarkKit">): LandmarkInfo {
  const own = ORG_LANDMARKS[orgSlug]?.[place.id];
  if (own) return own;
  if (place.landmarkKit === "global-hub") {
    return {
      name: "The Global Hub",
      fact: "Every office of the company is a pin on the globe below. What applies everywhere is kept here; what applies locally is kept in its office.",
    };
  }
  if (place.landmarkKit === "generic") {
    return {
      name: `${place.name} skyline`,
      fact: `Somewhere down there is the street you walked in on. Follow the traffic and you can almost find the office doors.`,
    };
  }
  return KIT_LANDMARKS[place.landmarkKit];
}
