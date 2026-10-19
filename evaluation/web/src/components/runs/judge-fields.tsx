"use client";

import { useId } from "react";
import { OptionSelect } from "@/components/app/option-select";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EFFORTS, type Effort } from "@/lib/api-types";

export type JudgeConfig = {
  enabled: boolean;
  models: { rubric: string | null; claims: string | null };
  samples: 1 | 3;
  efforts: { rubric: Effort | null; claims: Effort | null };
};

export const DEFAULT_JUDGE: JudgeConfig = {
  enabled: true,
  models: { rubric: null, claims: null },
  samples: 1,
  efforts: { rubric: null, claims: null },
};

const DEFAULT = "__default";

/** Judge models per role, samples and efforts. "Prompt default" leaves the prompt file's own value. */
export function JudgeFields({
  value,
  onChange,
  models = [],
  disabled,
}: {
  value: JudgeConfig;
  onChange: (next: JudgeConfig) => void;
  models?: string[];
  disabled?: boolean;
}) {
  const uid = useId();
  const modelOptions = [{ value: DEFAULT, label: "Prompt default (Haiku 5.5)" }, ...models.map((m) => ({ value: m, label: m }))];
  const effortOptions = [{ value: DEFAULT, label: "Prompt default" }, ...EFFORTS.map((e) => ({ value: e, label: e }))];

  function role(kind: "rubric" | "claims", title: string, hint: string) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${uid}-${kind}-model`}>{title} model</FieldLabel>
          <OptionSelect
            id={`${uid}-${kind}-model`}
            value={value.models[kind] ?? DEFAULT}
            onValueChange={(v) => onChange({ ...value, models: { ...value.models, [kind]: v === DEFAULT ? null : v } })}
            options={modelOptions}
            disabled={disabled}
            className="w-full"
          />
          <FieldDescription>{hint}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${uid}-${kind}-effort`}>{title} effort</FieldLabel>
          <OptionSelect
            id={`${uid}-${kind}-effort`}
            value={value.efforts[kind] ?? DEFAULT}
            onValueChange={(v) =>
              onChange({ ...value, efforts: { ...value.efforts, [kind]: v === DEFAULT ? null : (v as Effort) } })
            }
            options={effortOptions}
            disabled={disabled}
            className="w-full"
          />
        </Field>
      </div>
    );
  }

  return (
    <FieldGroup className="gap-4">
      {role("rubric", "Rubric", "Answer quality and follow-up resolution.")}
      {role("claims", "Claims", "Claims, key facts, context relevance and behaviour.")}
      <Field>
        <FieldLabel id={`${uid}-samples`}>Answer-quality samples</FieldLabel>
        <ToggleGroup
          aria-labelledby={`${uid}-samples`}
          variant="outline"
          size="sm"
          spacing={0}
          value={[String(value.samples)]}
          onValueChange={(v: string[]) => v[0] && onChange({ ...value, samples: v[0] === "3" ? 3 : 1 })}
          disabled={disabled}
        >
          <ToggleGroupItem value="1">1</ToggleGroupItem>
          <ToggleGroupItem value="3">3 (median)</ToggleGroupItem>
        </ToggleGroup>
        <FieldDescription>Three samples cost about three times the rubric and show the judge&apos;s spread.</FieldDescription>
      </Field>
    </FieldGroup>
  );
}
