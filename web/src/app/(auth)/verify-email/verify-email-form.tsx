"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { EmailDeliveryNote } from "@/components/auth/email-delivery-note";
import { FormAlert } from "@/components/auth/form-alert";
import { OtpField } from "@/components/auth/otp-field";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/button-link";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { useCooldown } from "@/hooks/use-cooldown";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage, OTP_LENGTH, RESEND_COOLDOWN_SECONDS, safeNext, withParams } from "@/lib/auth-utils";

export function VerifyEmailForm({ sender }: { sender: string | null }) {
  const uid = useId();
  const router = useRouter();
  const params = useSearchParams();
  const email = params.get("email") ?? "";
  const next = safeNext(params.get("next"));
  // Arriving from sign-up/sign-in means a code was just sent: start the cooldown, never send on mount.
  const cooldown = useCooldown(RESEND_COOLDOWN_SECONDS, params.get("sent") === "1");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const inFlight = useRef(false);

  if (!email) {
    return (
      <div className="flex flex-col gap-4">
        <FormAlert message="This link is missing an email address. Sign in again to get a new code." />
        <ButtonLink href="/sign-in" size="lg">
          Back to sign in
        </ButtonLink>
      </div>
    );
  }

  async function verify(code: string) {
    if (code.length !== OTP_LENGTH || inFlight.current) return;
    inFlight.current = true;
    setVerifying(true);
    setError(null);
    const { error } = await authClient.emailOtp.verifyEmail({ email, otp: code });
    inFlight.current = false;
    if (error) {
      setVerifying(false);
      setOtp("");
      setError(authErrorMessage(error, "We couldn't verify that code. Try again."));
      return;
    }
    // autoSignInAfterVerification: the session cookie is already set.
    router.push(next);
    router.refresh();
  }

  async function resend() {
    setResending(true);
    setError(null);
    const { error } = await authClient.emailOtp.sendVerificationOtp({ email, type: "email-verification" });
    setResending(false);
    if (error) {
      setError(authErrorMessage(error, "We couldn't send a new code. Wait a minute and try again."));
      return;
    }
    setOtp("");
    cooldown.start();
    toast.success("New code sent. Earlier codes no longer work.");
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void verify(otp);
      }}
      className="flex flex-col gap-5"
    >
      <FormAlert message={error} />
      <FieldGroup>
        <Field data-invalid={!!error || undefined}>
          <FieldLabel htmlFor={`${uid}-otp`}>Verification code</FieldLabel>
          <OtpField id={`${uid}-otp`} value={otp} onChange={setOtp} onComplete={verify} invalid={!!error} disabled={verifying} />
        </Field>
        <Button type="submit" size="lg" className="w-full" disabled={verifying || otp.length !== OTP_LENGTH}>
          {verifying && <Spinner data-icon="inline-start" />}
          {verifying ? "Verifying…" : "Verify and continue"}
        </Button>
      </FieldGroup>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">Didn&apos;t get it?</span>
        <Button type="button" variant="ghost" size="sm" onClick={resend} disabled={resending || cooldown.active}>
          {resending && <Spinner data-icon="inline-start" />}
          {cooldown.active ? `Resend in ${cooldown.remaining}s` : "Resend code"}
        </Button>
      </div>
      <EmailDeliveryNote sender={sender} />
      <p className="text-center text-sm text-muted-foreground">
        Wrong address?{" "}
        <Link href={withParams("/sign-up", { next: params.get("next") })} className="font-medium text-primary underline-offset-4 hover:underline">
          Start again
        </Link>
      </p>
    </form>
  );
}
