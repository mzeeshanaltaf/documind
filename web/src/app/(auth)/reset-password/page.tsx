import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthFormSkeleton } from "@/components/auth/auth-form-skeleton";
import { AuthHeader } from "@/components/auth/auth-header";
import { senderAddress } from "@/lib/email/sender";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false, follow: false } };

export default function ResetPasswordPage() {
  return (
    <>
      <AuthHeader
        title="Choose a new password"
        description="If an account exists for that email, we sent it a 6-digit code. It expires in 10 minutes."
      />
      <Suspense fallback={<AuthFormSkeleton fields={3} />}>
        <ResetPasswordForm sender={senderAddress()} />
      </Suspense>
    </>
  );
}
