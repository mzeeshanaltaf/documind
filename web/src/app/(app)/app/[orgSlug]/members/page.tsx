import { MailIcon, UsersIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { PageSkeleton } from "@/components/app/shell-skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireOrgAdmin } from "@/lib/auth-guards";
import { initials } from "@/lib/initials";
import { listMembers, listPendingInvitations } from "@/lib/org-members";
import { AddMemberForm } from "./add-member-form";
import { InvitationActions, RemoveMemberButton } from "./row-actions";

export const metadata: Metadata = { title: "Members" };

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

// hoursLeft is floored in SQL, so any past expiry is negative.
function expiryLabel(hoursLeft: number) {
  if (hoursLeft < 0) return { label: "Expired", expired: true };
  return { label: hoursLeft >= 1 ? `in ${hoursLeft} h` : "within the hour", expired: false };
}

export default function MembersPage({ params }: PageProps<"/app/[orgSlug]/members">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Members params={params} />
    </Suspense>
  );
}

async function Members({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { org, user } = await requireOrgAdmin(orgSlug);
  const [memberRows, invitations] = await Promise.all([listMembers(org.id), listPendingInvitations(org.id)]);

  return (
    <PageContainer>
      <PageHeader
        title="Members"
        description={`People who can ask questions about the documents in ${org.name}. Platform admins can always access every organization.`}
      />

      <AddMemberForm orgSlug={org.slug} />

      <section aria-labelledby="members-heading" className="mt-10 flex flex-col gap-3">
        <div className="flex items-baseline gap-2">
          <h2 id="members-heading" className="font-sans text-sm font-semibold">
            People with access
          </h2>
          <span className="text-sm text-muted-foreground tabular-nums">{memberRows.length}</span>
        </div>
        {memberRows.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UsersIcon />
              </EmptyMedia>
              <EmptyTitle>No members yet</EmptyTitle>
              <EmptyDescription>Add someone by email above. Existing accounts get access straight away.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="hidden sm:table-cell">Joined</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {memberRows.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar className="size-8">
                          {m.image && <AvatarImage src={m.image} alt="" />}
                          <AvatarFallback className="text-xs">{initials(m.name, m.email)}</AvatarFallback>
                        </Avatar>
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate font-medium">
                            {m.name || m.email}
                            {m.userId === user.id && <span className="font-normal text-muted-foreground"> (you)</span>}
                          </span>
                          <span className="truncate text-xs text-muted-foreground">{m.email}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant="secondary" className="capitalize">
                          {m.role}
                        </Badge>
                        {m.userRole === "admin" && <Badge variant="outline">Platform admin</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground tabular-nums sm:table-cell">
                      {dateFormat.format(new Date(m.createdAt))}
                    </TableCell>
                    <TableCell className="text-right">
                      <RemoveMemberButton
                        orgSlug={org.slug}
                        orgName={org.name}
                        memberId={m.id}
                        label={m.name || m.email}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section aria-labelledby="invitations-heading" className="mt-10 flex flex-col gap-3">
        <div className="flex items-baseline gap-2">
          <h2 id="invitations-heading" className="font-sans text-sm font-semibold">
            Pending invitations
          </h2>
          <span className="text-sm text-muted-foreground tabular-nums">{invitations.length}</span>
        </div>
        {invitations.length === 0 ? (
          <Empty className="border py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MailIcon />
              </EmptyMedia>
              <EmptyDescription>
                No one is waiting. Adding an email without an account sends them an invitation.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead className="hidden md:table-cell">Invited by</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.map((inv) => {
                  const expiry = expiryLabel(inv.hoursLeft);
                  return (
                    <TableRow key={inv.id}>
                      <TableCell className="max-w-0 truncate font-medium sm:max-w-none">{inv.email}</TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">
                        {inv.inviterName ?? "Unknown"}
                      </TableCell>
                      <TableCell>
                        {expiry.expired ? (
                          <Badge variant="outline" className="text-destructive">
                            Expired
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground tabular-nums">{expiry.label}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <InvitationActions orgSlug={org.slug} invitationId={inv.id} email={inv.email} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </PageContainer>
  );
}
