import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthFormSkeleton } from "@/components/auth/auth-form-skeleton";
import { AuthHeader } from "@/components/auth/auth-header";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Create an account", robots: { index: false, follow: false } };

export default function SignUpPage() {
  return (
    <>
      <AuthHeader
        title="Create your account"
        description="Your administrator adds you to your organization. We'll email you a code to confirm your address."
      />
      <Suspense fallback={<AuthFormSkeleton fields={3} />}>
        <SignUpForm />
      </Suspense>
    </>
  );
}
