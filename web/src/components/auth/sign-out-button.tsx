"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";

export function SignOutButton({
  redirectTo = "/sign-in",
  children = "Sign out",
  ...props
}: { redirectTo?: string } & Omit<React.ComponentProps<typeof Button>, "onClick">) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    await authClient.signOut();
    router.push(redirectTo);
    router.refresh();
  }

  return (
    <Button {...props} onClick={signOut} disabled={pending || props.disabled}>
      {pending && <Spinner data-icon="inline-start" />}
      {children}
    </Button>
  );
}
