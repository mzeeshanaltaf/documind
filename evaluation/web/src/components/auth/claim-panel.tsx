import { CircleCheckIcon } from "lucide-react";

/**
 * Auth-page companion panel: one real claim check from the golden set (golden-004, SIM-HR-001
 * §7.4, p. 59), showing what Evaluation does: split an answer into claims and check each one
 * against the passage it cites. Purely illustrative, hidden below lg.
 */
export function ClaimPanel() {
  return (
    <aside
      aria-label="Example of a checked claim"
      className="relative hidden overflow-hidden border-l bg-sidebar lg:flex lg:flex-col lg:justify-center lg:px-14 xl:px-20"
    >
      <figure className="mx-auto flex w-full max-w-md flex-col gap-6">
        <div className="flex items-baseline justify-between gap-4">
          <span className="font-mono text-[0.7rem] text-muted-foreground">golden-004 · claim 1 of 15</span>
          <span className="font-mono text-[0.7rem] text-muted-foreground">faithfulness 1.00</span>
        </div>

        <p className="text-[0.95rem] leading-relaxed text-foreground">
          The base policy provides a one-time home-office allowance of $500.
          <span className="ml-1.5 inline-flex translate-y-[-1px] items-center rounded-md bg-accent px-1.5 py-0.5 align-middle font-mono text-[0.7rem] text-accent-foreground">
            1
          </span>
        </p>

        <div className="rounded-lg bg-background p-5 shadow-sm ring-1 ring-border">
          <div className="flex items-baseline justify-between gap-4 border-b pb-3">
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-[0.7rem] tracking-wide text-muted-foreground">SIM-HR-001</span>
              <span className="font-heading text-[0.95rem] font-semibold">Human Resources Policy Manual</span>
            </div>
            <span className="shrink-0 font-mono text-[0.7rem] text-muted-foreground">p. 59</span>
          </div>
          <p className="pt-3 font-heading text-sm font-semibold">
            <span className="mr-1.5 font-mono text-xs font-normal text-muted-foreground">7.4</span>
            Equipment, Home Office and Connectivity Stipend
          </p>
          <p className="pt-2 font-heading text-[0.9rem] leading-relaxed text-muted-foreground">
            <span className="text-foreground">Home office. </span>
            <mark className="rounded-[3px] bg-highlight px-0.5 text-highlight-foreground">
              Hybrid and remote employees may claim a one-time home-office allowance of $500
            </mark>
            , up to $1,000 for fully remote employees.
          </p>
          <p className="mt-4 flex items-center gap-1.5 border-t pt-3 text-xs font-medium text-success">
            <CircleCheckIcon className="size-3.5" aria-hidden />
            Supported by source 1
          </p>
        </div>

        <figcaption className="text-xs text-muted-foreground">
          Every claim in an answer is checked against the passage it cites.
        </figcaption>
      </figure>
    </aside>
  );
}
