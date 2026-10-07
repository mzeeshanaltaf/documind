"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { z } from "zod";
import { FormAlert } from "@/components/auth/form-alert";
import { GoogleButton } from "@/components/auth/google-button";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage, safeNext, withParams } from "@/lib/auth-utils";

const schema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(100, "Keep your name under 100 characters."),
  email: z.email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters.").max(128, "Use at most 128 characters."),
});
type Errors = Partial<Record<keyof z.infer<typeof schema>, string>>;

export function SignUpForm() {
  const uid = useId();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [values, setValues] = useState({ name: "", email: params.get("email") ?? "", password: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const set = (key: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = schema.safeParse({ ...values, email: values.email.trim() });
    if (!parsed.success) {
      const fieldErrors: Errors = {};
      for (const issue of parsed.error.issues) fieldErrors[issue.path[0] as keyof Errors] ??= issue.message;
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setPending(true);
    const { error } = await authClient.signUp.email({ ...parsed.data, callbackURL: next });
    if (error) {
      setPending(false);
      setFormError(authErrorMessage(error, "We couldn't create your account. Try again in a moment."));
      return;
    }
    // requireEmailVerification: no session yet; a code is on its way.
    router.push(withParams("/verify-email", { email: parsed.data.email, next, sent: "1" }));
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <FormAlert message={formError} />
      <FieldGroup>
        <Field data-invalid={!!errors.name || undefined}>
          <FieldLabel htmlFor={`${uid}-name`}>Full name</FieldLabel>
          <Input
            id={`${uid}-name`}
            autoComplete="name"
            value={values.name}
            onChange={set("name")}
            aria-invalid={!!errors.name || undefined}
            disabled={pending}
            autoFocus
          />
          <FieldError>{errors.name}</FieldError>
        </Field>
        <Field data-invalid={!!errors.email || undefined}>
          <FieldLabel htmlFor={`${uid}-email`}>Work email</FieldLabel>
          <Input
            id={`${uid}-email`}
            type="email"
            inputMode="email"
            autoComplete="email"
            value={values.email}
            onChange={set("email")}
            aria-invalid={!!errors.email || undefined}
            disabled={pending}
          />
          <FieldError>{errors.email}</FieldError>
        </Field>
        <Field data-invalid={!!errors.password || undefined}>
          <FieldLabel htmlFor={`${uid}-password`}>Password</FieldLabel>
          <Input
            id={`${uid}-password`}
            type="password"
            autoComplete="new-password"
            value={values.password}
            onChange={set("password")}
            aria-invalid={!!errors.password || undefined}
            aria-describedby={`${uid}-password-hint`}
            disabled={pending}
          />
          {errors.password ? (
            <FieldError>{errors.password}</FieldError>
          ) : (
            <FieldDescription id={`${uid}-password-hint`}>At least 8 characters.</FieldDescription>
          )}
        </Field>
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending && <Spinner data-icon="inline-start" />}
          {pending ? "Creating account…" : "Create account"}
        </Button>
        <FieldSeparator>or</FieldSeparator>
        <GoogleButton next={next} onError={setFormError} />
      </FieldGroup>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href={withParams("/sign-in", { next: params.get("next") })}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
