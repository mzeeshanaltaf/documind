import { KeyRoundIcon, LockIcon } from "lucide-react";

type Access = "open" | "card" | "locked";

// Simtora's rooms (one per department present; Corporate lives in the presentation room).
const ROOMS: { name: string; access: Access; here?: boolean }[] = [
  { name: "Reception", access: "open", here: true },
  { name: "Human Resources", access: "card" },
  { name: "IT", access: "card" },
  { name: "Finance", access: "card" },
  { name: "Procurement", access: "card" },
  { name: "Facilities", access: "card" },
  { name: "Compliance", access: "card" },
  { name: "International", access: "card" },
  { name: "Presentation room", access: "open" },
  { name: "Play area", access: "open" },
  { name: "Rooftop", access: "locked" },
];

const OFFICES = ["San Francisco", "Lahore", "Berlin", "Paris", "Sydney", "London", "Global Hub"];

function AccessLabel({ access }: { access: Access }) {
  if (access === "open") return <span className="text-muted-foreground">Open</span>;
  const Icon = access === "card" ? KeyRoundIcon : LockIcon;
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <Icon className="size-3.5" aria-hidden />
      {access === "card" ? "Access card" : "Locked"}
    </span>
  );
}

/**
 * Auth-page companion panel: the lobby directory of Simtora's San Francisco office, showing how
 * the office works (Reception issues access cards, each card opens a department's room, the
 * rooftop unlocks later). Purely illustrative, hidden below lg.
 */
export function DirectoryPanel() {
  return (
    <aside
      aria-label="Example office directory"
      className="relative hidden overflow-hidden border-l bg-sidebar lg:flex lg:flex-col lg:justify-center lg:px-14 xl:px-20"
    >
      <figure className="mx-auto flex w-full max-w-md flex-col gap-6">
        <div className="rounded-lg bg-background shadow-sm ring-1 ring-border">
          <div className="flex items-baseline justify-between gap-4 border-b px-5 pt-5 pb-3">
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-[0.7rem] tracking-wide text-muted-foreground uppercase">Directory</span>
              <span className="font-heading text-[0.95rem] font-semibold">Simtora Technologies</span>
            </div>
            <span className="shrink-0 font-mono text-[0.7rem] text-muted-foreground">San Francisco HQ</span>
          </div>
          <ul className="flex flex-col px-5 py-2 text-sm">
            {ROOMS.map((room) => (
              <li
                key={room.name}
                className="flex items-center justify-between gap-4 border-b border-dashed py-1.5 text-[0.8125rem] last:border-b-0"
              >
                <span className="flex items-center gap-2">
                  {room.name}
                  {room.here && (
                    <span className="inline-flex items-center gap-1 font-mono text-[0.65rem] text-primary uppercase">
                      <span className="size-1.5 rounded-full bg-primary" aria-hidden />
                      You are here
                    </span>
                  )}
                </span>
                <AccessLabel access={room.access} />
              </li>
            ))}
          </ul>
        </div>

        <figcaption className="flex flex-col gap-2 text-xs text-muted-foreground">
          <span>
            Each room has an expert who answers from your company&apos;s policies and shows the page it came from.
          </span>
          <span className="font-mono text-[0.7rem]">{OFFICES.join(" · ")}</span>
        </figcaption>
      </figure>
    </aside>
  );
}
