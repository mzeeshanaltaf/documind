import { SearchIcon, UsersIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { PageSkeleton } from "@/components/app/shell-skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/button-link";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { platformAdminEmails } from "@/lib/auth";
import { requireAdmin } from "@/lib/auth-guards";
import { searchUsers, USERS_PAGE_SIZE } from "@/lib/admin-users";
import { initials } from "@/lib/initials";
import { UserRowActions } from "./user-row-actions";

export const metadata: Metadata = { title: "Users" };

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default function AdminUsersPage({ searchParams }: PageProps<"/admin/users">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Users searchParams={searchParams} />
    </Suspense>
  );
}

async function Users({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user: actor } = await requireAdmin();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 200) : "";
  const page = Math.max(1, Number(typeof sp.page === "string" ? sp.page : 1) || 1);
  const { users, total } = await searchUsers(q, (page - 1) * USERS_PAGE_SIZE);
  const envAdmins = new Set(platformAdminEmails());
  const pages = Math.max(1, Math.ceil(total / USERS_PAGE_SIZE));
  const pageHref = (p: number) => `/admin/users?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;

  return (
    <PageContainer className="max-w-6xl">
      <PageHeader
        title="Users"
        description="Everyone with a DocuMind account. Platform admins manage every organization; suspended users can't sign in."
      />

      <form action="/admin/users" method="get" role="search" className="mb-5 flex max-w-md gap-2">
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput name="q" type="search" defaultValue={q} placeholder="Search by name or email" aria-label="Search users" />
        </InputGroup>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      {users.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersIcon />
            </EmptyMedia>
            <EmptyTitle>{q ? "No matching users" : "No users yet"}</EmptyTitle>
            <EmptyDescription>
              {q ? `Nobody's name or email contains "${q}".` : "Accounts appear here once people sign up."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <p className="mb-2 text-sm text-muted-foreground tabular-nums">
            {total} {total === 1 ? "user" : "users"}
            {q && <> matching &ldquo;{q}&rdquo;</>}
          </p>
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="hidden sm:table-cell">Status</TableHead>
                  <TableHead className="hidden md:table-cell">Organizations</TableHead>
                  <TableHead className="hidden lg:table-cell">Joined</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => {
                  const isSelf = u.id === actor.id;
                  const isEnvAdmin = envAdmins.has(u.email.toLowerCase());
                  return (
                    <TableRow key={u.id}>
                      <TableCell className="max-w-0 min-w-40 sm:max-w-none">
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar className="size-8">
                            {u.image && <AvatarImage src={u.image} alt="" />}
                            <AvatarFallback className="text-xs">{initials(u.name, u.email)}</AvatarFallback>
                          </Avatar>
                          <div className="flex min-w-0 flex-col">
                            <span className="truncate font-medium">
                              {u.name || u.email}
                              {isSelf && <span className="font-normal text-muted-foreground"> (you)</span>}
                            </span>
                            {/* The Status column is hidden on phones; keep a suspension visible. */}
                            {u.banned && <span className="text-xs font-medium text-destructive sm:hidden">Suspended</span>}
                            <span className="truncate text-xs text-muted-foreground">{u.email}</span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {u.role === "admin" ? <Badge>Platform admin</Badge> : <Badge variant="secondary">User</Badge>}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {u.banned ? (
                          <Badge variant="destructive">Suspended</Badge>
                        ) : u.emailVerified ? (
                          <span className="text-muted-foreground">Active</span>
                        ) : (
                          <span className="text-muted-foreground">Unverified</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden max-w-64 md:table-cell">
                        {u.orgs.length === 0 ? (
                          <span className="text-muted-foreground">None</span>
                        ) : (
                          <ul className="flex flex-wrap gap-1.5">
                            {u.orgs.map((o) => (
                              <li key={o.slug}>
                                <Link
                                  href={`/app/${o.slug}/chat`}
                                  className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                                >
                                  {o.name}
                                  <span className="text-muted-foreground capitalize">· {o.role}</span>
                                </Link>
                              </li>
                            ))}
                          </ul>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground tabular-nums lg:table-cell">
                        {dateFormat.format(new Date(u.createdAt))}
                      </TableCell>
                      <TableCell className="text-right">
                        {!isSelf && (
                          <UserRowActions
                            userId={u.id}
                            label={u.name || u.email}
                            isAdmin={u.role === "admin"}
                            isBanned={!!u.banned}
                            isEnvAdmin={isEnvAdmin}
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {pages > 1 && (
            <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm">
              <span className="text-muted-foreground tabular-nums">
                Page {page} of {pages}
              </span>
              <div className="flex gap-2">
                <ButtonLink
                  href={pageHref(page - 1)}
                  variant="outline"
                  size="sm"
                  aria-disabled={page <= 1}
                  className={page <= 1 ? "pointer-events-none opacity-50" : undefined}
                >
                  Previous
                </ButtonLink>
                <ButtonLink
                  href={pageHref(page + 1)}
                  variant="outline"
                  size="sm"
                  aria-disabled={page >= pages}
                  className={page >= pages ? "pointer-events-none opacity-50" : undefined}
                >
                  Next
                </ButtonLink>
              </div>
            </nav>
          )}
        </>
      )}
    </PageContainer>
  );
}
