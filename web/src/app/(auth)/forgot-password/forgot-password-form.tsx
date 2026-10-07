"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { z } from "zod";
import { FormAlert } from "@/components/auth/form-alert";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage, withParams } from "@/lib/auth-utils";

const emailSchema = z.email("Enter a valid email address.");

export function ForgotPasswordForm() {
  const uid = useId();
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = emailSchema.safeParse(email.trim());
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "Enter a valid email address.");
      return;
    }
    setFieldError(null);
    setPending(true);
    // Succeeds for unknown addresses too (no account enumeration), so the next screen stays neutral.
    const { error } = await authClient.emailOtp.requestPasswordReset({ email: parsed.data });
    if (error) {
      setPending(false);
      setFormError(authErrorMessage(error, "We couldn't send a code. Wait a minute and try again."));
      return;
    }
    router.push(withParams("/reset-password", { email: parsed.data, sent: "1" }));
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <FormAlert message={formError} />
      <FieldGroup>
        <Field data-invalid={!!fieldError || undefined}>
          <FieldLabel htmlFor={`${uid}-email`}>Work email</FieldLabel>
          <Input
            id={`${uid}-email`}
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!fieldError || undefined}
            disabled={pending}
            autoFocus
          />
          <FieldError>{fieldError}</FieldError>
        </Field>
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending && <Spinner data-icon="inline-start" />}
          {pending ? "Sending code…" : "Send reset code"}
        </Button>
      </FieldGroup>
      <p className="text-center text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link href="/sign-in" className="font-medium text-primary underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
