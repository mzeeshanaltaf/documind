"use client";

import { ArrowLeftRightIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId, useTransition } from "react";
import { type Option, OptionSelect } from "@/components/app/option-select";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/**
 * Run A, run B and the scoring mode, each a search param so the server renders the comparison.
 * Changing a run drops `mode` (the new pair may not share it).
 */
export function RunPickers({
  runs,
  a,
  b,
  mode,
  modes,
}: {
  runs: Option[];
  a: string | null;
  b: string | null;
  mode: string | null;
  modes: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const id = useId();

  function go(next: { a?: string | null; b?: string | null; mode?: string | null }) {
    const query = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value) query.set(key, value);
      else query.delete(key);
    }
    startTransition(() => router.replace(`${pathname}?${query.toString()}`, { scroll: false }));
  }

  return (
    <div className="flex flex-wrap items-end gap-2" role="group" aria-label="Runs to compare">
      <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
        <label htmlFor={`${id}-a`} className="text-xs font-medium text-muted-foreground">
          Run A (baseline)
        </label>
        <OptionSelect
          id={`${id}-a`}
          value={a ?? ""}
          placeholder="Pick a run"
          onValueChange={(value) => go({ a: value, mode: null })}
          options={runs}
          className="w-full"
        />
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Swap A and B"
        title="Swap A and B"
        disabled={!a || !b || pending}
        onClick={() => go({ a: b, b: a })}
      >
        <ArrowLeftRightIcon />
      </Button>
      <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
        <label htmlFor={`${id}-b`} className="text-xs font-medium text-muted-foreground">
          Run B (candidate)
        </label>
        <OptionSelect
          id={`${id}-b`}
          value={b ?? ""}
          placeholder="Pick a run"
          onValueChange={(value) => go({ b: value, mode: null })}
          options={runs}
          className="w-full"
        />
      </div>
      {modes.length > 1 && mode && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-mode`} className="text-xs font-medium text-muted-foreground">
            Scores
          </label>
          <OptionSelect
            id={`${id}-mode`}
            value={mode}
            onValueChange={(value) => go({ mode: value })}
            options={modes.map((m) => ({ value: m, label: m }))}
            className="min-w-28 font-mono"
          />
        </div>
      )}
      {pending && <Spinner className="mb-2 text-muted-foreground" aria-label="Updating" />}
    </div>
  );
}
