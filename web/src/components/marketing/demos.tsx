import { CheckIcon, FileTextIcon, SearchIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { AgentChip, Chip } from "./hero-visual";

/** A product excerpt: a bordered piece of real UI, not a decorative card. */
function Excerpt({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div aria-hidden className={cn("overflow-hidden rounded-lg border bg-background text-sm", className)}>
      {children}
    </div>
  );
}

const UPLOADS = [
  { name: "HR-Germany-Manual.pdf", meta: "32 pages", status: "ready" as const },
  { name: "Procurement-Policy-Manual.pdf", meta: "103 pages", status: "indexing" as const },
  { name: "IT-Policy-Manual.pdf", meta: "Queued", status: "queued" as const },
];

export function UploadExcerpt() {
  return (
    <Excerpt>
      <ul className="divide-y">
        {UPLOADS.map((file) => (
          <li key={file.name} className="flex items-center gap-3 px-3.5 py-3">
            <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-[0.8125rem] font-medium">{file.name}</span>
              {file.status === "indexing" ? (
                <span className="flex items-center gap-2">
                  <span className="h-1 w-20 overflow-hidden rounded-full bg-muted">
                    <span className="block h-full w-3/5 rounded-full bg-primary" />
                  </span>
                  <span className="text-xs text-muted-foreground">Embedding · 60%</span>
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">{file.meta}</span>
              )}
            </span>
            {file.status === "ready" && (
              <span className="inline-flex items-center gap-1 text-xs text-success">
                <CheckIcon className="size-3.5" />
                Ready
              </span>
            )}
          </li>
        ))}
      </ul>
    </Excerpt>
  );
}

const METADATA = [
  ["Document", <span key="d" className="font-mono text-xs">SIM-HR-102</span>],
  ["Department", "HR"],
  ["Jurisdiction", <span key="j"><span className="font-mono text-xs">DE</span> Germany</span>],
  ["Type", "Country supplement"],
  ["Indexed", "32 pages · 52 passages"],
] as const;

export function IndexExcerpt() {
  return (
    <Excerpt>
      <dl className="divide-y">
        {METADATA.map(([term, value]) => (
          <div key={term} className="grid grid-cols-[6.5rem_1fr] items-baseline gap-3 px-3.5 py-2">
            <dt className="text-xs text-muted-foreground">{term}</dt>
            <dd className="text-[0.8125rem]">{value}</dd>
          </div>
        ))}
      </dl>
    </Excerpt>
  );
}

export function AskExcerpt() {
  return (
    <Excerpt className="flex flex-col gap-3 p-3.5">
      <p className="ml-auto w-fit rounded-xl rounded-br-sm bg-muted px-3 py-1.5 text-[0.8125rem]">
        What&apos;s the notice period after probation in Berlin?
      </p>
      <AgentChip department="HR" country="Germany" />
      <p className="text-[0.8125rem] leading-relaxed">
        Three months to the end of a month, for both sides.
        <Chip n={1} />
      </p>
      <div className="flex items-baseline justify-between gap-3 rounded-md bg-muted/70 px-2.5 py-2">
        <span className="min-w-0 truncate text-xs">
          <span className="font-mono text-[0.7rem] text-muted-foreground">SIM-HR-102</span> Appendix A
        </span>
        <span className="shrink-0 font-mono text-[0.7rem] text-muted-foreground">p. 31</span>
      </div>
    </Excerpt>
  );
}

function QueryRow({ query, mono = false }: { query: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 border-b px-4 py-3">
      <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className={cn("min-w-0 truncate", mono ? "font-mono text-[0.8125rem]" : "text-sm")}>{query}</span>
    </div>
  );
}

function MatchLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-medium tracking-wide text-muted-foreground">{children}</span>;
}

/** Hybrid search: one exact-code query (keyword) and one paraphrase (meaning). */
export function SearchDemo() {
  return (
    <div aria-hidden className="grid gap-4 text-sm">
      <div className="overflow-hidden rounded-lg border bg-background">
        <QueryRow query="SIM-PRC-001" mono />
        <div className="flex flex-col gap-1.5 px-4 py-3.5">
          <MatchLabel>Keyword match</MatchLabel>
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-heading text-[0.95rem] font-semibold">Procurement Policy Manual</span>
            <span className="shrink-0 font-mono text-[0.7rem] text-muted-foreground">v1.1 · 103 pp.</span>
          </div>
          <span className="text-xs text-muted-foreground">
            <span className="font-mono text-[0.7rem]">SIM-PRC-001</span> · Simtora Technologies, Inc.
          </span>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border bg-background">
        <QueryRow query="can I expense my internet?" />
        <div className="flex flex-col gap-1.5 px-4 py-3.5">
          <MatchLabel>Meaning match</MatchLabel>
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-heading text-[0.95rem] font-semibold">
              <span className="mr-1.5 font-mono text-xs font-normal text-muted-foreground">7.4</span>
              Equipment, Home Office and Connectivity Stipend
            </span>
            <span className="shrink-0 font-mono text-[0.7rem] text-muted-foreground">p. 59</span>
          </div>
          <p className="font-heading text-[0.8125rem] leading-relaxed text-muted-foreground">
            Employees who work remotely at least one day a week receive a{" "}
            <mark className="rounded-[3px] bg-highlight px-0.5 text-highlight-foreground">
              monthly stipend of $75 for internet and mobile phone costs
            </mark>
            , paid through payroll.
          </p>
        </div>
      </div>
    </div>
  );
}

const DEPARTMENTS = ["HR", "IT", "Finance", "Procurement", "Facilities", "Compliance", "Corporate", "International"];

/** Routing: the question names a city; the router picks the department and the country. */
export function RoutingDemo() {
  return (
    <div aria-hidden className="flex flex-col gap-4 text-sm">
      <div className="flex flex-col gap-3 rounded-lg border bg-background p-4">
        <p className="ml-auto w-fit max-w-[90%] rounded-xl rounded-br-sm bg-muted px-3.5 py-2">
          How much sick pay does our Berlin team get?
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <AgentChip department="HR" country="Germany" />
        </div>
        <ol className="flex flex-col divide-y rounded-md border">
          <li className="flex items-baseline justify-between gap-3 px-3 py-2">
            <span className="min-w-0 truncate">
              <span className="mr-1.5 font-mono text-[0.7rem] text-muted-foreground">SIM-HR-102</span>
              Germany HR Manual
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">Country manual</span>
          </li>
          <li className="flex items-baseline justify-between gap-3 px-3 py-2">
            <span className="min-w-0 truncate">
              <span className="mr-1.5 font-mono text-[0.7rem] text-muted-foreground">SIM-HR-001</span>
              HR Policy Manual
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">Base manual</span>
          </li>
        </ol>
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {DEPARTMENTS.map((department) => (
          <li key={department} className="rounded-4xl border px-2.5 py-1 text-xs text-muted-foreground">
            {department}
          </li>
        ))}
      </ul>
    </div>
  );
}
