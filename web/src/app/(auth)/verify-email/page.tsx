import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthFormSkeleton } from "@/components/auth/auth-form-skeleton";
import { AuthHeader } from "@/components/auth/auth-header";
import { senderAddress } from "@/lib/email/sender";
import { VerifyEmailForm } from "./verify-email-form";
import { EmailFromParams } from "./email-from-params";

export const metadata: Metadata = { title: "Verify your email", robots: { index: false, follow: false } };

export default function VerifyEmailPage() {
  return (
    <>
      <AuthHeader
        title="Check your email"
        description={
          <Suspense fallback="We sent a 6-digit code to your inbox. It expires in 10 minutes.">
            <EmailFromParams />
          </Suspense>
        }
      />
      <Suspense fallback={<AuthFormSkeleton fields={1} />}>
        <VerifyEmailForm sender={senderAddress()} />
      </Suspense>
    </>
  );
}
