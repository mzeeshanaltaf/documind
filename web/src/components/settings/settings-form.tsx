"use client";

import { ChevronRightIcon } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { saveSettings } from "@/app/(app)/app/[orgSlug]/settings/actions";
import { OptionSelect } from "@/components/app/option-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import type { OrgSettings, Price, SettingsValues, Tier } from "@/lib/api-types";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const TIERS: { value: Tier; title: string; description: string }[] = [
  { value: "standard", title: "Standard", description: "Fastest and predictable. Full price." },
  {
    value: "flex",
    title: "Flex",
    description: "About 50% cheaper but slower and may queue; falls back to Standard when unavailable.",
  },
  { value: "auto", title: "Auto", description: "OpenAI picks the tier per request. Usually billed as Standard." },
];

const FIELDS = ["chat_model", "router_model", "chat_service_tier", "background_service_tier", "top_k"] as const;

function pick(settings: OrgSettings): SettingsValues {
  return {
    chat_model: settings.chat_model,
    router_model: settings.router_model,
    chat_service_tier: settings.chat_service_tier,
    background_service_tier: settings.background_service_tier,
    top_k: settings.top_k,
  };
}

function money(value: number | undefined) {
  if (value === undefined) return "n/a";
  return `$${value < 0.1 ? value.toFixed(3).replace(/0$/, "") : value.toFixed(2)}`;
}

export function SettingsForm({ orgSlug, initial }: { orgSlug: string; initial: OrgSettings }) {
  const id = useId();
  const [saved, setSaved] = useState(initial);
  const [values, setValues] = useState<SettingsValues>(() => pick(initial));
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [topKText, setTopKText] = useState(String(initial.top_k));
  const [pending, startTransition] = useTransition();

  const chatModels = saved.models.filter((m) => m.startsWith("gpt-"));
  const modelOptions = (current: string) =>
    [...new Set([current, ...chatModels])].map((m) => ({ value: m, label: m }));

  const changes = Object.fromEntries(
    FIELDS.filter((key) => values[key] !== saved[key]).map((key) => [key, values[key]]),
  ) as Partial<SettingsValues>;
  const dirty = Object.keys(changes).length > 0;
  const topKValid = /^\d+$/.test(topKText) && Number(topKText) >= 4 && Number(topKText) <= 15;

  function set<K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty || !topKValid) return;
    startTransition(async () => {
      const result = await saveSettings(orgSlug, changes);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSaved(result.data);
      setValues(pick(result.data));
      setTopKText(String(result.data.top_k));
      toast.success("Settings saved. They apply to the next question.");
    });
  }

  const priceTier = values.chat_service_tier === "flex" ? "flex" : "standard";
  const modelPrices = saved.pricing[values.chat_model];
  const price: Price | undefined = modelPrices?.[priceTier] ?? modelPrices?.standard;
  const flexMissing = values.chat_service_tier === "flex" && !modelPrices?.flex;

  const isDefault = (key: keyof SettingsValues) => values[key] === saved.defaults[key];

  return (
    <form onSubmit={submit} className="flex max-w-2xl flex-col gap-8">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`${id}-chat-model`}>
            Answer model
            {isDefault("chat_model") && <Badge variant="secondary">Default</Badge>}
          </FieldLabel>
          <OptionSelect
            id={`${id}-chat-model`}
            value={values.chat_model}
            onValueChange={(v) => set("chat_model", v)}
            options={modelOptions(values.chat_model)}
            className="w-full sm:w-72"
          />
          <FieldDescription>Writes every answer. Applies to the next question asked in this organization.</FieldDescription>
          <dl
            aria-label={`Prices for ${values.chat_model} on the ${priceTier} tier, per million tokens`}
            className="mt-1 grid w-full grid-cols-3 divide-x rounded-lg border text-sm sm:w-fit"
          >
            {[
              ["Input", price?.inputPerMillion],
              ["Cached input", price?.cachedInputPerMillion],
              ["Output", price?.outputPerMillion],
            ].map(([label, value]) => (
              <div key={label as string} className="flex flex-col gap-0.5 px-4 py-2.5">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="font-medium tabular-nums">
                  {money(value as number | undefined)}
                  <span className="text-xs font-normal text-muted-foreground"> /1M</span>
                </dd>
              </div>
            ))}
          </dl>
          <FieldDescription>
            {flexMissing
              ? "This model has no Flex price, so it is billed at Standard."
              : `Showing ${priceTier === "flex" ? "Flex" : "Standard"} prices${values.chat_service_tier === "auto" ? " (Auto is usually billed as Standard)" : ""}.`}
          </FieldDescription>
        </Field>

        <FieldSeparator />

        <TierChoice
          legend="Answer service tier"
          description="Used for routing and answers, where people are waiting."
          name={`${id}-chat-tier`}
          value={values.chat_service_tier}
          defaultValue={saved.defaults.chat_service_tier}
          onChange={(v) => set("chat_service_tier", v)}
        />

        <FieldSeparator />

        <TierChoice
          legend="Background service tier"
          description="Used for ingestion, classification and conversation titles. Nobody waits on these, so Flex is the default."
          name={`${id}-background-tier`}
          value={values.background_service_tier}
          defaultValue={saved.defaults.background_service_tier}
          onChange={(v) => set("background_service_tier", v)}
        />
      </FieldGroup>

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger render={<Button type="button" variant="ghost" size="sm" className="-ml-2" />}>
          <ChevronRightIcon data-icon="inline-start" className={cn("transition-transform duration-200", advancedOpen && "rotate-90")} />
          Advanced
        </CollapsibleTrigger>
        <CollapsibleContent>
          <FieldGroup className="pt-4">
            <Field>
              <FieldLabel htmlFor={`${id}-router-model`}>
                Router model
                {isDefault("router_model") && <Badge variant="secondary">Default</Badge>}
              </FieldLabel>
              <OptionSelect
                id={`${id}-router-model`}
                value={values.router_model}
                onValueChange={(v) => set("router_model", v)}
                options={modelOptions(values.router_model)}
                className="w-full sm:w-72"
              />
              <FieldDescription>Picks the department and country for each question and rewrites follow-ups.</FieldDescription>
            </Field>
            <Field data-invalid={!topKValid || undefined}>
              <FieldLabel htmlFor={`${id}-top-k`}>
                Passages per answer
                {isDefault("top_k") && <Badge variant="secondary">Default</Badge>}
              </FieldLabel>
              <Input
                id={`${id}-top-k`}
                inputMode="numeric"
                value={topKText}
                aria-invalid={!topKValid || undefined}
                className="w-24 tabular-nums"
                onChange={(e) => {
                  setTopKText(e.target.value);
                  if (/^\d+$/.test(e.target.value)) set("top_k", Number(e.target.value));
                }}
              />
              <FieldDescription>
                {topKValid
                  ? "How many retrieved passages the answer model reads (4 to 15). More gives broader answers at a higher cost."
                  : "Enter a whole number from 4 to 15."}
              </FieldDescription>
            </Field>
          </FieldGroup>
        </CollapsibleContent>
      </Collapsible>

      <div className="flex items-center gap-3 border-t pt-5">
        <Button type="submit" disabled={!dirty || !topKValid || pending}>
          {pending && <Spinner data-icon="inline-start" />}
          {pending ? "Saving…" : "Save settings"}
        </Button>
        {dirty && !pending && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setValues(pick(saved));
              setTopKText(String(saved.top_k));
            }}
          >
            Discard changes
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground" aria-live="polite">
          {dirty ? "Unsaved changes" : saved.updated_at ? `Last changed ${formatDate(saved.updated_at)}` : "Using the defaults"}
        </span>
      </div>
    </form>
  );
}

function TierChoice({
  legend,
  description,
  name,
  value,
  defaultValue,
  onChange,
}: {
  legend: string;
  description: string;
  name: string;
  value: Tier;
  defaultValue: Tier;
  onChange: (tier: Tier) => void;
}) {
  return (
    <FieldSet>
      <FieldLegend variant="label">{legend}</FieldLegend>
      <FieldDescription>{description}</FieldDescription>
      <RadioGroup value={value} onValueChange={(v) => onChange(v as Tier)} className="sm:grid-cols-3">
        {TIERS.map((tier) => (
          <FieldLabel key={tier.value} htmlFor={`${name}-${tier.value}`}>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldTitle>
                  {tier.title}
                  {tier.value === defaultValue && <Badge variant="secondary">Default</Badge>}
                </FieldTitle>
                <FieldDescription className="text-xs">{tier.description}</FieldDescription>
              </FieldContent>
              <RadioGroupItem value={tier.value} id={`${name}-${tier.value}`} />
            </Field>
          </FieldLabel>
        ))}
      </RadioGroup>
    </FieldSet>
  );
}
