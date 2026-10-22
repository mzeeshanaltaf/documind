import { type ComponentType, type LazyExoticComponent, lazy } from "react";
import type { LandmarkKit } from "@/lib/locations";
import type { LandmarkProps } from "./common";

/** One lazy chunk per kit, so a city loads only its own landmark. The hub has its own scene. */
export const LANDMARKS: Record<Exclude<LandmarkKit, "global-hub">, LazyExoticComponent<ComponentType<LandmarkProps>>> = {
  "golden-gate": lazy(() => import("./GoldenGate")),
  minar: lazy(() => import("./Minar")),
  brandenburg: lazy(() => import("./Brandenburg")),
  eiffel: lazy(() => import("./Eiffel")),
  "opera-house": lazy(() => import("./OperaHouse")),
  "elizabeth-tower": lazy(() => import("./ElizabethTower")),
  generic: lazy(() => import("./Generic")),
};
