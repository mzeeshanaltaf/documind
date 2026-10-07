"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormAlert } from "@/components/auth/form-alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-utils";

export function AcceptInvitationActions({
  invitationId,
  orgSlug,
  orgName,
}: {
  invitationId: string;
  orgSlug: string;
  orgName: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setPending("accept");
    setError(null);
    const { error } = await authClient.organization.acceptInvitation({ invitationId });
    if (error) {
      setPending(null);
      setError(authErrorMessage(error, "We couldn't accept the invitation. Try again in a moment."));
      return;
    }
    router.push(`/app/${orgSlug}/chat`);
    router.refresh();
  }

  async function decline() {
    setPending("decline");
    setError(null);
    const { error } = await authClient.organization.rejectInvitation({ invitationId });
    if (error) {
      setPending(null);
      setError(authErrorMessage(error, "We couldn't decline the invitation. Try again in a moment."));
      return;
    }
    router.push("/app");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <FormAlert message={error} />
      <Button size="lg" onClick={accept} disabled={!!pending}>
        {pending === "accept" && <Spinner data-icon="inline-start" />}
        {pending === "accept" ? "Joining…" : `Join ${orgName}`}
      </Button>
      <Button size="lg" variant="ghost" onClick={decline} disabled={!!pending}>
        {pending === "decline" && <Spinner data-icon="inline-start" />}
        Decline
      </Button>
    </div>
  );
}
