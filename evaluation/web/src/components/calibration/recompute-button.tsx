"use client";

import { RefreshCwIcon } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { recomputeCalibration } from "@/app/(app)/review/actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/** Grades recompute on their own a few seconds after a submit; this does it now. */
export function RecomputeButton() {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await recomputeCalibration();
          if (result.ok) toast.success(`Recomputed ${result.data.rows.length} calibration${result.data.rows.length === 1 ? "" : "s"}.`);
          else toast.error(result.error);
        })
      }
    >
      {pending ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}
      {pending ? "Recomputing…" : "Recompute"}
    </Button>
  );
}
