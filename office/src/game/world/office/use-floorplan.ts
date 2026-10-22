import { useMemo } from "react";
import { useGame } from "@/game/store/game-store";
import { roomDepartments } from "@/lib/departments";
import { buildFloorplan, type Floorplan } from "./floorplan";

/** The dev sandbox has no org: its office gets Simtora's departments. */
export const SAMPLE_DEPARTMENTS = ["HR", "IT", "Finance", "Procurement", "Facilities", "Compliance", "International"];

const plans = new Map<string, Floorplan>();

/** One plan per department list, shared by the scene and the HUD (minimap, card picker). */
export function floorplanFor(departments: string[]): Floorplan {
  const key = departments.join("|");
  let plan = plans.get(key);
  if (!plan) plans.set(key, (plan = buildFloorplan(departments)));
  return plan;
}

/** The departments with a room in the current office (from the org's searchable documents). */
export function useOfficeDepartments(): string[] {
  const documents = useGame((s) => s.office?.documents);
  return useMemo(() => (documents ? roomDepartments(documents) : SAMPLE_DEPARTMENTS), [documents]);
}

export function useFloorplan(): Floorplan {
  return floorplanFor(useOfficeDepartments());
}
