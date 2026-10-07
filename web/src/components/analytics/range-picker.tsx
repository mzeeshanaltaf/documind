"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { type Option, OptionSelect } from "@/components/app/option-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { AnalyticsRange, RangeKey } from "@/lib/analytics-range";

const KEYS: { value: RangeKey; label: string }[] = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "custom", label: "Custom" },
];

/** One row of filters above the charts; every change is a URL change (shareable, back-button friendly). */
export function RangePicker({ range, orgs, orgId }: { range: AnalyticsRange; orgs?: Option[]; orgId?: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [custom, setCustom] = useState(range.key === "custom");
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const id = useId();

  function go(update: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(update)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    startTransition(() => router.push(`${pathname}?${params.toString()}`, { scroll: false }));
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {orgs && (
        <OptionSelect
          aria-label="Organization"
          value={orgId ?? "all"}
          onValueChange={(v) => go({ org: v === "all" ? null : v })}
          options={[{ value: "all", label: "All organizations" }, ...orgs]}
        />
      )}
      <ToggleGroup
        aria-label="Date range"
        variant="outline"
        size="sm"
        spacing={0}
        value={[custom ? "custom" : range.key]}
        onValueChange={(value: string[]) => {
          const next = value[0] as RangeKey | undefined;
          if (!next) return;
          if (next === "custom") {
            setCustom(true);
            return;
          }
          setCustom(false);
          go({ range: next, from: null, to: null });
        }}
      >
        {KEYS.map((k) => (
          <ToggleGroupItem key={k.value} value={k.value}>
            {k.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {custom && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            go({ range: "custom", from, to });
          }}
        >
          <label htmlFor={`${id}-from`} className="sr-only">
            From
          </label>
          <Input id={`${id}-from`} type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="h-7 w-36" />
          <span className="text-sm text-muted-foreground">to</span>
          <label htmlFor={`${id}-to`} className="sr-only">
            To
          </label>
          <Input id={`${id}-to`} type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="h-7 w-36" />
          <Button type="submit" size="sm" variant="outline" disabled={!from || !to || from > to}>
            Apply
          </Button>
        </form>
      )}
      {pending && <Spinner className="text-muted-foreground" />}
    </div>
  );
}
