"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { z } from "zod";
import { FormAlert } from "@/components/auth/form-alert";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/button-link";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-utils";
import { RESERVED_SLUGS, SLUG_PATTERN, slugify } from "@/lib/slug";

const schema = z.object({
  name: z.string().trim().min(2, "Use at least 2 characters.").max(80, "Keep it under 80 characters."),
  slug: z
    .string()
    .min(2, "Use at least 2 characters.")
    .max(48, "Keep it under 48 characters.")
    .regex(SLUG_PATTERN, "Use lowercase letters, numbers and single hyphens.")
    .refine((s) => !RESERVED_SLUGS.has(s), "That address is reserved. Pick another."),
});
type Errors = Partial<Record<"name" | "slug", string>>;

export function NewOrgForm() {
  const uid = useId();
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = schema.safeParse({ name, slug });
    if (!parsed.success) {
      const fieldErrors: Errors = {};
      for (const issue of parsed.error.issues) fieldErrors[issue.path[0] as keyof Errors] ??= issue.message;
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setPending(true);

    const check = await authClient.organization.checkSlug({ slug: parsed.data.slug });
    if (check.error) {
      setPending(false);
      setErrors({ slug: "Another organization already uses this address." });
      return;
    }

    const { error } = await authClient.organization.create({ name: parsed.data.name, slug: parsed.data.slug });
    if (error) {
      setPending(false);
      setFormError(authErrorMessage(error, "We couldn't create the organization. Try again in a moment."));
      return;
    }
    router.push(`/app/${parsed.data.slug}/members`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <FormAlert message={formError} />
      <FieldGroup>
        <Field data-invalid={!!errors.name || undefined}>
          <FieldLabel htmlFor={`${uid}-org-name`}>Organization name</FieldLabel>
          <Input
            id={`${uid}-org-name`}
            value={name}
            placeholder="Simtora Technologies"
            onChange={(e) => {
              setName(e.target.value);
              if (!slugEdited) setSlug(slugify(e.target.value));
            }}
            aria-invalid={!!errors.name || undefined}
            disabled={pending}
            autoFocus
          />
          <FieldError>{errors.name}</FieldError>
        </Field>
        <Field data-invalid={!!errors.slug || undefined}>
          <FieldLabel htmlFor={`${uid}-org-slug`}>Address</FieldLabel>
          <InputGroup>
            <InputGroupAddon>
              <InputGroupText className="font-mono text-xs">/app/</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              id={`${uid}-org-slug`}
              value={slug}
              placeholder="simtora"
              className="font-mono text-sm"
              onChange={(e) => {
                setSlugEdited(true);
                setSlug(e.target.value.toLowerCase());
              }}
              aria-invalid={!!errors.slug || undefined}
              aria-describedby={`${uid}-org-slug-hint`}
              disabled={pending}
            />
          </InputGroup>
          {errors.slug ? (
            <FieldError>{errors.slug}</FieldError>
          ) : (
            <FieldDescription id={`${uid}-org-slug-hint`}>
              Used in links. Lowercase letters, numbers and hyphens.
            </FieldDescription>
          )}
        </Field>
      </FieldGroup>
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending && <Spinner data-icon="inline-start" />}
          {pending ? "Creating…" : "Create organization"}
        </Button>
        <ButtonLink href="/app" variant="ghost">
          Cancel
        </ButtonLink>
      </div>
    </form>
  );
}
