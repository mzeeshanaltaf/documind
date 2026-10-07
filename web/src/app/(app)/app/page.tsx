import { ArrowRightIcon, Building2Icon, MailIcon, PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ShellSkeleton } from "@/components/app/shell-skeleton";
import { StandaloneShell } from "@/components/app/standalone-shell";
import { ButtonLink } from "@/components/button-link";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { isPlatformAdmin, listAccessibleOrgs, requireSession } from "@/lib/auth-guards";
import { pool } from "@/lib/db";

export const metadata: Metadata = { title: "Your organizations" };

export default function AppIndexPage() {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <ResolveOrg />
    </Suspense>
  );
}

async function ResolveOrg() {
  const { user, session } = await requireSession();
  const orgs = await listAccessibleOrgs(user);

  if (orgs.length > 0) {
    const target = orgs.find((o) => o.id === session.activeOrganizationId) ?? orgs[0];
    redirect(`/app/${target.slug}/chat`);
  }

  const isAdmin = isPlatformAdmin(user);
  const { rows: invitations } = await pool.query<{ id: string; orgName: string }>(
    `select i.id, o.name as "orgName"
       from invitation i join organization o on o.id = i."organizationId"
      where lower(i.email) = lower($1) and i.status = 'pending' and i."expiresAt" > now()
      order by i."createdAt" desc`,
    [user.email],
  );

  return (
    <StandaloneShell email={user.email}>
      <main className="flex flex-1 items-center justify-center px-5 py-16">
        {invitations.length > 0 ? (
          <Empty className="max-w-md">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MailIcon />
              </EmptyMedia>
              <EmptyTitle className="font-heading text-xl">You have an invitation</EmptyTitle>
              <EmptyDescription>Accept it to start asking questions about the organization&apos;s documents.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              {invitations.map((inv) => (
                <ButtonLink
                  key={inv.id}
                  href={`/accept-invitation/${inv.id}`}
                  variant="outline"
                  className="w-full justify-between"
                >
                  Join {inv.orgName}
                  <ArrowRightIcon data-icon="inline-end" />
                </ButtonLink>
              ))}
            </EmptyContent>
          </Empty>
        ) : isAdmin ? (
          <Empty className="max-w-md">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Building2Icon />
              </EmptyMedia>
              <EmptyTitle className="font-heading text-xl">Create your first organization</EmptyTitle>
              <EmptyDescription>
                An organization holds one company&apos;s policy documents and the people who can ask about them.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <ButtonLink href="/app/new-org">
                <PlusIcon data-icon="inline-start" />
                Create organization
              </ButtonLink>
            </EmptyContent>
          </Empty>
        ) : (
          <Empty className="max-w-md">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Building2Icon />
              </EmptyMedia>
              <EmptyTitle className="font-heading text-xl">You haven&apos;t been added to an organization yet</EmptyTitle>
              <EmptyDescription>
                Ask your administrator to add {user.email}. Once they do, your organization&apos;s documents appear
                here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </main>
    </StandaloneShell>
  );
}
