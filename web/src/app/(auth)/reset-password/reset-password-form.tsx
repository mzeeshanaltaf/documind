"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { EmailDeliveryNote } from "@/components/auth/email-delivery-note";
import { FormAlert } from "@/components/auth/form-alert";
import { OtpField } from "@/components/auth/otp-field";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/button-link";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useCooldown } from "@/hooks/use-cooldown";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage, OTP_LENGTH, RESEND_COOLDOWN_SECONDS, withParams } from "@/lib/auth-utils";

const schema = z
  .object({
    otp: z.string().length(OTP_LENGTH, "Enter the 6-digit code from your email."),
    password: z.string().min(8, "Use at least 8 characters.").max(128, "Use at most 128 characters."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "The passwords don't match." });
type Errors = Partial<Record<"otp" | "password" | "confirm", string>>;

export function ResetPasswordForm({ sender }: { sender: string | null }) {
  const uid = useId();
  const router = useRouter();
  const params = useSearchParams();
  const email = params.get("email") ?? "";
  const cooldown = useCooldown(RESEND_COOLDOWN_SECONDS, params.get("sent") === "1");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [resending, setResending] = useState(false);

  if (!email) {
    return (
      <div className="flex flex-col gap-4">
        <FormAlert message="Start from the reset page so we know which account to update." />
        <ButtonLink href="/forgot-password" size="lg">
          Request a reset code
        </ButtonLink>
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = schema.safeParse({ otp, password, confirm });
    if (!parsed.success) {
      const fieldErrors: Errors = {};
      for (const issue of parsed.error.issues) fieldErrors[issue.path[0] as keyof Errors] ??= issue.message;
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setPending(true);
    const { error } = await authClient.emailOtp.resetPassword({ email, otp, password });
    if (error) {
      setPending(false);
      setFormError(authErrorMessage(error, "We couldn't reset your password. Try again."));
      return;
    }
    // resetPassword doesn't create a session: send them through sign-in.
    router.push(withParams("/sign-in", { email, reset: "1" }));
  }

  async function resend() {
    setResending(true);
    setFormError(null);
    const { error } = await authClient.emailOtp.requestPasswordReset({ email });
    setResending(false);
    if (error) {
      setFormError(authErrorMessage(error, "We couldn't send a new code. Wait a minute and try again."));
      return;
    }
    setOtp("");
    cooldown.start();
    toast.success("If an account exists for that email, a new code is on its way.");
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <FormAlert message={formError} />
      <FieldGroup>
        <Field data-invalid={!!errors.otp || undefined}>
          <FieldLabel htmlFor={`${uid}-otp`}>Reset code</FieldLabel>
          <OtpField id={`${uid}-otp`} value={otp} onChange={setOtp} invalid={!!errors.otp} disabled={pending} />
          <FieldError>{errors.otp}</FieldError>
        </Field>
        <Field data-invalid={!!errors.password || undefined}>
          <FieldLabel htmlFor={`${uid}-password`}>New password</FieldLabel>
          <Input
            id={`${uid}-password`}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!errors.password || undefined}
            disabled={pending}
          />
          {errors.password ? (
            <FieldError>{errors.password}</FieldError>
          ) : (
            <FieldDescription>At least 8 characters.</FieldDescription>
          )}
        </Field>
        <Field data-invalid={!!errors.confirm || undefined}>
          <FieldLabel htmlFor={`${uid}-confirm`}>Confirm new password</FieldLabel>
          <Input
            id={`${uid}-confirm`}
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-invalid={!!errors.confirm || undefined}
            disabled={pending}
          />
          <FieldError>{errors.confirm}</FieldError>
        </Field>
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending && <Spinner data-icon="inline-start" />}
          {pending ? "Updating password…" : "Update password"}
        </Button>
      </FieldGroup>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">No code yet?</span>
        <Button type="button" variant="ghost" size="sm" onClick={resend} disabled={resending || cooldown.active}>
          {resending && <Spinner data-icon="inline-start" />}
          {cooldown.active ? `Resend in ${cooldown.remaining}s` : "Resend code"}
        </Button>
      </div>
      <EmailDeliveryNote sender={sender} />
    </form>
  );
}
