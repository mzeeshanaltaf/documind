import { cn } from "@/lib/utils";

/** Inline citation chip, styled like the chat's `CitationChip` (static: nothing to open here). */
export function Chip({ n, active = false }: { n: number; active?: boolean }) {
  return (
    <span
      className={cn(
        "mx-0.5 inline-flex -translate-y-px items-center rounded-md px-1.5 py-0.5 align-middle font-mono text-[0.7rem] leading-none",
        active ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground",
      )}
    >
      {n}
    </span>
  );
}

/** Routing chip, styled like the chat's outline `Badge`. */
export function AgentChip({ department, country }: { department: string; country?: string }) {
  return (
    <span className="inline-flex h-5 w-fit items-center gap-1 rounded-4xl border px-2 py-0.5 text-xs font-medium whitespace-nowrap text-muted-foreground">
      <span className="text-foreground">{department} agent</span>
      {country && <span aria-hidden>·</span>}
      {country && <span>{country}</span>}
    </span>
  );
}

const ROWS: { item: string; rule: React.ReactNode }[] = [
  {
    item: "Entitlement",
    rule: "30 working days per calendar year (for a 5-day week). The statutory minimum is 20 days (24 on a 6-day week); the remaining 10 days are contractual.",
  },
  {
    item: "Request",
    rule: "In the HR system; managers decide within 3 business days.",
  },
  {
    item: "Carry-over",
    rule: (
      <>
        <mark className="dm-stroke bg-transparent px-0.5">
          Unused leave carries over to March 31 of the following year. Leave does not lapse unless the Company
          has written to the employee in good time (by October 1)
        </mark>{" "}
        telling them how many days remain and the date it would lapse.
      </>
    ),
  },
];

/**
 * Hero product visual, built from the real chat and PDF-viewer styles: an answer with
 * citation chips, and the cited page open at the highlighted passage. Content is a real
 * passage from the seed corpus (SIM-HR-102, Germany HR Manual, §5.2, p. 16).
 */
export function HeroVisual() {
  return (
    <figure className="relative mx-auto w-full max-w-136 lg:mx-0 lg:max-w-none">
      <figcaption className="sr-only">
        Example: an employee asks whether unused leave carries over in Germany. DocuMind answers with numbered
        citations, and the first citation opens the Germany HR Manual at page 16 with the carry-over rule
        highlighted.
      </figcaption>

      {/* The cited page, open in the viewer. */}
      <div
        className="dm-rise relative ml-auto w-[94%] overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-border sm:w-[86%]"
        style={{ "--dm-delay": "120ms" } as React.CSSProperties}
        aria-hidden
      >
        <div className="flex items-center justify-between gap-3 border-b bg-muted/60 px-4 py-2.5">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 font-mono text-[0.7rem] tracking-wide whitespace-nowrap text-muted-foreground">SIM-HR-102</span>
            <span className="truncate text-xs font-medium">Germany HR Manual (Berlin)</span>
          </div>
          <span className="shrink-0 font-mono text-[0.7rem] text-muted-foreground">16 / 32</span>
        </div>

        <div className="px-5 pt-4 pb-5 sm:px-6">
          <p className="flex items-baseline gap-2 font-heading text-[0.95rem] font-semibold">
            <span className="font-mono text-xs font-normal text-muted-foreground">5.2</span>
            Annual Leave
          </p>
          <dl className="mt-3 grid grid-cols-[5.5rem_1fr] border-t font-heading text-[0.78rem] leading-relaxed sm:grid-cols-[6.5rem_1fr] sm:text-[0.8125rem]">
            {ROWS.map((row) => (
              <div key={row.item} className="col-span-2 grid grid-cols-subgrid border-b py-2">
                <dt className="pr-3 font-semibold">{row.item}</dt>
                <dd className="text-muted-foreground">{row.rule}</dd>
              </div>
            ))}
          </dl>
          <p className="pt-3 text-right font-mono text-[0.65rem] text-muted-foreground">Page 16 of 32</p>
        </div>
      </div>

      {/* The answer that cites it, overlapping the page's lower-left corner. */}
      <div
        className="dm-rise relative -mt-8 mr-auto w-[94%] rounded-xl bg-background p-4 shadow-md ring-1 ring-border sm:-mt-11 sm:w-[78%] sm:p-5"
        style={{ "--dm-delay": "0ms" } as React.CSSProperties}
        aria-hidden
      >
        <p className="ml-auto w-fit max-w-[85%] rounded-xl rounded-br-sm bg-muted px-3.5 py-2 text-sm">
          Can I carry over unused leave in Germany?
        </p>
        <div className="mt-3.5 flex flex-col gap-2.5">
          <AgentChip department="HR" country="Germany" />
          <p className="text-[0.875rem] leading-relaxed sm:text-[0.9375rem]">
            Yes, until <strong className="font-semibold">31 March</strong> of the following year. It only lapses if
            HR wrote to you by 1 October with the days left and the lapse date.
            <Chip n={1} active />
            Your full entitlement is 30 working days on a five-day week.
            <Chip n={2} />
          </p>
          <p className="text-xs text-muted-foreground">2 sources · SIM-HR-102 §5.2 p. 16, Appendix A p. 31</p>
        </div>
      </div>
    </figure>
  );
}
