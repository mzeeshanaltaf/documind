import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthFormSkeleton } from "@/components/auth/auth-form-skeleton";
import { AuthHeader } from "@/components/auth/auth-header";
import { FormAlert } from "@/components/auth/form-alert";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { ButtonLink } from "@/components/button-link";
import { getSession } from "@/lib/auth-guards";
import { withParams } from "@/lib/auth-utils";
import { pool } from "@/lib/db";
import { AcceptInvitationActions } from "./accept-invitation-actions";

export const metadata: Metadata = { title: "Accept invitation", robots: { index: false, follow: false } };

type InvitationRow = {
  id: string;
  email: string;
  status: string;
  expiresAt: Date;
  orgName: string;
  orgSlug: string;
  inviterName: string | null;
};

export default function AcceptInvitationPage({ params }: PageProps<"/accept-invitation/[id]">) {
  return (
    <Suspense fallback={<AuthFormSkeleton fields={1} />}>
      <Invitation params={params} />
    </Suspense>
  );
}

async function Invitation({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { rows } = await pool.query<InvitationRow>(
    `select i.id, i.email, i.status, i."expiresAt", o.name as "orgName", o.slug as "orgSlug", u.name as "inviterName"
       from invitation i
       join organization o on o.id = i."organizationId"
       left join "user" u on u.id = i."inviterId"
      where i.id = $1`,
    [id],
  );
  const invitation = rows[0];
  const session = await getSession();
  const self = `/accept-invitation/${id}`;

  if (!invitation) {
    return (
      <Outcome
        title="Invitation not found"
        description="This link doesn't match an invitation. Check that you copied the whole link from the email."
      />
    );
  }

  const org = invitation.orgName;

  if (invitation.status === "accepted") {
    return (
      <Outcome
        title={`You're already in ${org}`}
        description="This invitation has been accepted."
        action={
          session ? (
            <ButtonLink href={`/app/${invitation.orgSlug}/chat`} size="lg">
              Open {org}
            </ButtonLink>
          ) : (
            <ButtonLink href={withParams("/sign-in", { next: self })} size="lg">
              Sign in
            </ButtonLink>
          )
        }
      />
    );
  }

  if (invitation.status !== "pending") {
    return (
      <Outcome
        title="This invitation is no longer valid"
        description={`It was withdrawn or declined. Ask your administrator to invite you to ${org} again.`}
      />
    );
  }

  if (new Date(invitation.expiresAt) < new Date()) {
    return (
      <Outcome
        title="This invitation has expired"
        description={`Invitations last 48 hours. Ask your administrator to resend the invitation to ${org}.`}
      />
    );
  }

  const header = (
    <AuthHeader
      title={`Join ${org}`}
      description={
        <>
          {invitation.inviterName ?? "Your administrator"} invited{" "}
          <span className="font-medium wrap-anywhere text-foreground">{invitation.email}</span> to ask questions about the documents in{" "}
          {org}.
        </>
      }
    />
  );

  if (!session) {
    return (
      <>
        {header}
        <div className="flex flex-col gap-3">
          <ButtonLink
            href={withParams("/sign-in", { next: self, email: invitation.email })}
            size="lg"
          >
            Sign in to accept
          </ButtonLink>
          <ButtonLink
            href={withParams("/sign-up", { next: self, email: invitation.email })}
            size="lg"
            variant="outline"
          >
            Create an account
          </ButtonLink>
          <p className="pt-1 text-xs text-muted-foreground">Use {invitation.email}; the invitation only works for that address.</p>
        </div>
      </>
    );
  }

  if (session.user.email.toLowerCase() !== invitation.email.toLowerCase()) {
    return (
      <>
        {header}
        <div className="flex flex-col gap-4">
          <FormAlert
            message={`You're signed in as ${session.user.email}. Sign out, then sign in as ${invitation.email} to accept.`}
          />
          <SignOutButton redirectTo={withParams("/sign-in", { next: self, email: invitation.email })} size="lg">
            Switch account
          </SignOutButton>
        </div>
      </>
    );
  }

  return (
    <>
      {header}
      <AcceptInvitationActions invitationId={invitation.id} orgSlug={invitation.orgSlug} orgName={org} />
    </>
  );
}

function Outcome({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <>
      <AuthHeader title={title} description={description} />
      <div className="flex flex-col gap-3">
        {action}
        <ButtonLink href="/app" size="lg" variant={action ? "ghost" : "outline"}>
          Go to DocuMind
        </ButtonLink>
      </div>
    </>
  );
}
