"use client";

import { XIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { type Option, OptionSelect } from "@/components/app/option-select";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export type UrlFilter = { name: string; label: string; options: Option[] };

const ALL = "__all";

/** One row of filters above a list; each writes a search param, so the server renders the result. */
export function UrlFilters({ filters }: { filters: UrlFilter[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const active = filters.some((f) => params.get(f.name));

  function set(name: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value && value !== ALL) next.set(name, value);
    else next.delete(name);
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  function clear() {
    const next = new URLSearchParams(params);
    for (const f of filters) next.delete(f.name);
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
      {filters.map((filter) => (
        <OptionSelect
          key={filter.name}
          size="sm"
          aria-label={filter.label}
          value={params.get(filter.name) ?? ALL}
          onValueChange={(value) => set(filter.name, value)}
          options={[{ value: ALL, label: `All ${filter.label.toLowerCase()}` }, ...filter.options]}
          className="min-w-36"
        />
      ))}
      {active && (
        <Button variant="ghost" size="sm" onClick={clear}>
          <XIcon data-icon="inline-start" />
          Clear
        </Button>
      )}
      {pending && <Spinner className="text-muted-foreground" aria-label="Updating" />}
    </div>
  );
}
