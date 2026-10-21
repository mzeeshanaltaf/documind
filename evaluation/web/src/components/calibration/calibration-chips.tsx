import type { CalibrationBadge as Badge } from "@/lib/api-types";
import { metricLabel } from "@/lib/metrics";
import { CalibrationBadge } from "./calibration-badge";

/** Each gradable judge metric's status for the prompt files and models as they are now. */
export function CalibrationChips({ badges }: { badges: Badge[] }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {badges.map((badge) => (
        <li key={badge.metric} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5">
          <span className="text-xs">{metricLabel(badge.metric)}</span>
          <CalibrationBadge badge={badge} />
        </li>
      ))}
    </ul>
  );
}
