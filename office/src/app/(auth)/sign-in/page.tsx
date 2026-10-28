import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthFormSkeleton } from "@/components/auth/auth-form-skeleton";
import { AuthHeader } from "@/components/auth/auth-header";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <>
      <AuthHeader title="Sign in to the DocuMind 3D office"
        description="Walk into your company's 3D office and ask its experts. Sign in with your DocuMind account." />
      <Suspense fallback={<AuthFormSkeleton fields={2} />}>
        <SignInForm />
      </Suspense>
    </>
  );
}
