"use client";

import { UserPlusIcon } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { FormAlert } from "@/components/auth/form-alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { addMemberByEmail } from "./actions";

export function AddMemberForm({ orgSlug }: { orgSlug: string }) {
  const uid = useId();
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = z.email().safeParse(email.trim());
    if (!parsed.success) {
      setFieldError("Enter a valid email address.");
      return;
    }
    setFieldError(null);
    startTransition(async () => {
      const result = await addMemberByEmail(orgSlug, parsed.data);
      if (result.ok) {
        setEmail("");
        toast.success(result.message);
      } else {
        setFormError(result.error);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:p-5">
      <Field data-invalid={!!fieldError || undefined}>
        <FieldLabel htmlFor={`${uid}-member-email`}>Add someone by email</FieldLabel>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id={`${uid}-member-email`}
            type="email"
            inputMode="email"
            autoComplete="off"
            placeholder="name@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!fieldError || undefined}
            aria-describedby={`${uid}-member-email-hint`}
            disabled={pending}
            className="sm:max-w-sm"
          />
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner data-icon="inline-start" /> : <UserPlusIcon data-icon="inline-start" />}
            {pending ? "Adding…" : "Add member"}
          </Button>
        </div>
        {fieldError ? (
          <FieldError>{fieldError}</FieldError>
        ) : (
          <FieldDescription id={`${uid}-member-email-hint`}>
            People with a DocuMind account get access right away. Anyone else gets an email invitation.
          </FieldDescription>
        )}
      </Field>
      <FormAlert message={formError} />
    </form>
  );
}
