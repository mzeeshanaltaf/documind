"use client";

import Link from "next/link";
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
import { authErrorMessage, safeNext, withParams } from "@/lib/auth-utils";

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
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(
    params.get("error") === "google" ? "Google sign-in didn't complete. Try again, or use your email and password." : null,
  );
  const [pending, setPending] = useState(false);

  const notice = params.get("reset")
    ? "Password updated. Sign in with your new password."
    : params.get("reauth")
      ? "Your session ended. Sign in again to continue."
      : null;

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
      // Unverified account: the server already emailed a fresh code (sendOnSignIn).
      if (error.code === "EMAIL_NOT_VERIFIED") {
        router.push(withParams("/verify-email", { email: parsed.data.email, next, sent: "1" }));
        return;
      }
      setFormError(authErrorMessage(error, "Sign-in failed. Try again in a moment."));
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
          <FieldLabel htmlFor={`${uid}-email`}>Work email</FieldLabel>
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
            <Link
              href={withParams("/forgot-password", { email: email.trim() || null })}
              className="text-xs font-medium text-primary underline-offset-4 hover:underline"
            >
              Forgot password?
            </Link>
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
        New to DocuMind?{" "}
        <Link
          href={withParams("/sign-up", { next: params.get("next"), email: email.trim() || null })}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Create an account
        </Link>
      </p>
    </form>
  );
}
