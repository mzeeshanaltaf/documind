"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { z } from "zod";
import { FormAlert } from "@/components/auth/form-alert";
import { GoogleButton } from "@/components/auth/google-button";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";
import { safeNext, signInErrorMessage } from "@/lib/auth-utils";
import { DOCUMIND_URL } from "@/lib/site";

const schema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});
type Errors = Partial<Record<keyof z.infer<typeof schema>, string>>;

export function SignInForm() {
  const uid = useId();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  // `?error=` comes from the Google callback, or from requireAdmin() for a demoted admin.
  const [formError, setFormError] = useState<string | null>(signInErrorMessage(params.get("error")));
  const [pending, setPending] = useState(false);
  const notice = !params.get("error") && params.get("reauth") ? "Your session ended. Sign in again to continue." : null;

  const forgotHref = `${DOCUMIND_URL}/forgot-password${email.trim() ? `?email=${encodeURIComponent(email.trim())}` : ""}`;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = schema.safeParse({ email: email.trim(), password });
    if (!parsed.success) {
      const fieldErrors: Errors = {};
      for (const issue of parsed.error.issues) fieldErrors[issue.path[0] as keyof Errors] ??= issue.message;
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setPending(true);
    const { error } = await authClient.signIn.email({ ...parsed.data, callbackURL: next });
    if (error) {
      setPending(false);
      setFormError(signInErrorMessage(error.code, error.message ?? undefined));
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <FormAlert message={formError} />
      {!formError && <FormAlert message={notice} tone="success" />}
      <FieldGroup>
        <Field data-invalid={!!errors.email || undefined}>
          <FieldLabel htmlFor={`${uid}-email`}>Email</FieldLabel>
          <Input
            id={`${uid}-email`}
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!errors.email || undefined}
            disabled={pending}
            autoFocus
          />
          <FieldError>{errors.email}</FieldError>
        </Field>
        <Field data-invalid={!!errors.password || undefined}>
          <div className="flex items-center justify-between">
            <FieldLabel htmlFor={`${uid}-password`}>Password</FieldLabel>
            <a href={forgotHref} className="text-xs font-medium text-primary underline-offset-4 hover:underline">
              Forgot password?
            </a>
          </div>
          <Input
            id={`${uid}-password`}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!errors.password || undefined}
            disabled={pending}
          />
          <FieldError>{errors.password}</FieldError>
        </Field>
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending && <Spinner data-icon="inline-start" />}
          {pending ? "Signing in…" : "Sign in"}
        </Button>
        <FieldSeparator>or</FieldSeparator>
        <GoogleButton next={next} onError={setFormError} />
      </FieldGroup>
      <p className="text-center text-sm text-muted-foreground">
        No account?{" "}
        <a href={DOCUMIND_URL} className="font-medium text-primary underline-offset-4 hover:underline">
          Accounts are managed in DocuMind
        </a>
      </p>
    </form>
  );
}
