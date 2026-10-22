"use client";

import { useEffect } from "react";
import { recordVisit } from "@/app/(game)/actions";

/**
 * Records the visit once the location page is open in the browser (not during the server render,
 * which a prefetch could trigger): cities visited, and the "Resume in …" choice. Idempotent, so
 * StrictMode's second effect run is harmless.
 */
export function RecordVisit({ orgId, locationId }: { orgId: string; locationId: string }) {
  useEffect(() => {
    recordVisit(orgId, locationId).catch((error: unknown) => console.error("[visit] not recorded", error));
  }, [orgId, locationId]);
  return null;
}
