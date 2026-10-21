import { ClipboardCheckIcon, GaugeIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { PageSkeleton } from "@/components/app/shell-skeleton";
import { ButtonLink } from "@/components/button-link";
import { CalibrationChips } from "@/components/calibration/calibration-chips";
import { CalibrationTable } from "@/components/calibration/calibration-table";
import { RecomputeButton } from "@/components/calibration/recompute-button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import type { CalibrationList } from "@/lib/api-types";
import { requireAdmin } from "@/lib/auth-guards";
import { apiJson } from "@/lib/eval-api";

export const metadata: Metadata = { title: "Calibration" };

export default function CalibrationPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Calibrations />
    </Suspense>
  );
}

async function Calibrations() {
  const { user } = await requireAdmin();
  const { rows, current, thresholds } = await apiJson<CalibrationList>("calibration", { userId: user.id });

  return (
    <PageContainer className="max-w-6xl gap-8">
      <PageHeader
        title="Calibration"
        description="How far the Claude judge can be trusted: its agreement with human reviewers per metric, prompt version and judge model."
        actions={
          <>
            {rows.length > 0 && <RecomputeButton />}
            <ButtonLink href="/review/new">
              <ClipboardCheckIcon data-icon="inline-start" />
              Grade a sample
            </ButtonLink>
          </>
        }
      />

      <section className="flex flex-col gap-3">
        <header className="flex flex-col gap-0.5">
          <h2 className="font-sans text-sm font-semibold">Current prompts</h2>
          <p className="text-xs text-muted-foreground">
            Each gradable metric against its prompt file as it is now and the prompt&apos;s default model. Editing a
            prompt makes it stale until a sample is regraded.
          </p>
        </header>
        <CalibrationChips badges={current} />
      </section>

      <section className="flex flex-col gap-3">
        <header className="flex flex-col gap-0.5">
          <h2 className="font-sans text-sm font-semibold">Agreement</h2>
          <p className="max-w-[80ch] text-xs text-muted-foreground">
            Uncalibrated below {thresholds.min_n} graded cases; unreliable when κw is under {thresholds.unreliable_below};
            moderate up to {thresholds.calibrated_from}; calibrated from κw {thresholds.calibrated_from} with at least{" "}
            {thresholds.calibrated_n} cases. κw is quadratic-weighted (a 4 against a 5 counts less than a 1 against a 5);
            faithfulness uses plain κ over claim verdicts. Open a row for its confusion matrix.
          </p>
        </header>
        {rows.length ? (
          <CalibrationTable rows={rows} />
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <GaugeIcon />
              </EmptyMedia>
              <EmptyTitle>No human grades yet</EmptyTitle>
              <EmptyDescription>
                Sample a judged run into a review queue and grade it blind with the judge&apos;s own rubric. Agreement
                shows up here a few seconds after each grade.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <ButtonLink href="/review/new">Start a review queue</ButtonLink>
            </EmptyContent>
          </Empty>
        )}
      </section>
    </PageContainer>
  );
}
