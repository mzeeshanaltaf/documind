/**
 * Auth-page companion panel: a real cited answer from the seed corpus
 * (SIM-HR-102, §5.2, p. 16), showing the product's promise instead of a
 * decorative gradient. Purely illustrative, hidden below lg.
 */
export function SourcePanel() {
  return (
    <aside
      aria-label="Example of a cited answer"
      className="relative hidden overflow-hidden border-l bg-sidebar lg:flex lg:flex-col lg:justify-center lg:px-14 xl:px-20"
    >
      <figure className="mx-auto flex w-full max-w-md flex-col gap-6">
        <p className="self-end rounded-xl rounded-br-sm bg-background px-4 py-2.5 text-sm shadow-xs ring-1 ring-border">
          How much annual leave do employees in Berlin get?
        </p>

        <div className="flex flex-col gap-3">
          <p className="text-[0.95rem] leading-relaxed text-foreground">
            Employees in Germany get <strong className="font-semibold">30 working days</strong> a year on a
            five-day week: the statutory 20 plus 10 contractual days. Unused leave carries over to 31 March of
            the following year.
            <span className="ml-1.5 inline-flex translate-y-[-1px] items-center rounded-md bg-accent px-1.5 py-0.5 align-middle font-mono text-[0.7rem] text-accent-foreground">
              1
            </span>
          </p>
        </div>

        <div className="rounded-lg bg-background p-5 shadow-sm ring-1 ring-border">
          <div className="flex items-baseline justify-between gap-4 border-b pb-3">
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-[0.7rem] tracking-wide text-muted-foreground">SIM-HR-102</span>
              <span className="font-heading text-[0.95rem] font-semibold">Germany HR Manual</span>
            </div>
            <span className="shrink-0 font-mono text-[0.7rem] text-muted-foreground">p. 16</span>
          </div>
          <p className="pt-3 font-heading text-sm font-semibold">
            <span className="mr-1.5 font-mono text-xs font-normal text-muted-foreground">5.2</span>
            Annual Leave
          </p>
          <p className="pt-2 font-heading text-[0.9rem] leading-relaxed text-muted-foreground">
            <span className="text-foreground">Entitlement. </span>
            <mark className="rounded-[3px] bg-highlight px-0.5 text-highlight-foreground">
              30 working days per calendar year (for a 5-day week). The statutory minimum is 20 days
            </mark>{" "}
            (24 on a 6-day week); the remaining 10 days are contractual.
          </p>
        </div>

        <figcaption className="text-xs text-muted-foreground">
          Every answer links to the passage it came from.
        </figcaption>
      </figure>
    </aside>
  );
}
