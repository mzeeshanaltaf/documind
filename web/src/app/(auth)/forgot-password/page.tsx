import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthFormSkeleton } from "@/components/auth/auth-form-skeleton";
import { AuthHeader } from "@/components/auth/auth-header";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Reset your password", robots: { index: false, follow: false } };

export default function ForgotPasswordPage() {
  return (
    <>
      <AuthHeader
        title="Reset your password"
        description="Enter the email you sign in with and we'll send you a 6-digit code."
      />
      <Suspense fallback={<AuthFormSkeleton fields={1} />}>
        <ForgotPasswordForm />
      </Suspense>
    </>
  );
}
