import { Building2Icon } from "lucide-react";
import { Suspense } from "react";
import { ButtonLink } from "@/components/button-link";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { apiJson } from "@/lib/api";
import type { Me, Org } from "@/lib/api-types";
import { requireSession, withoutEvalOrgs } from "@/lib/auth-guards";
import { DOCUMIND_URL } from "@/lib/site";
import { getPlayer } from "./actions";

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-12 sm:px-10">
      <Suspense fallback={<OrgListSkeleton />}>
        <OrgList />
      </Suspense>
    </main>
  );
}

const ROLE_LABELS: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member" };

function roleLabel(org: Org, isAdmin: boolean) {
  if (org.role) return ROLE_LABELS[org.role] ?? org.role;
  return isAdmin ? "Platform admin" : null;
}

async function OrgList() {
  const { user } = await requireSession();
  // getPlayer() creates the player row on a first visit.
  const [me, player] = await Promise.all([apiJson<Me>("me", { userId: user.id }), getPlayer()]);
  const orgs = await withoutEvalOrgs(me.orgs);

  if (orgs.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Building2Icon />
          </EmptyMedia>
          <EmptyTitle className="font-heading text-xl">You&apos;re not in an organization yet</EmptyTitle>
          <EmptyDescription>
            The office opens for the organizations you belong to in DocuMind. Ask an admin to invite you, or
            request to join one.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <ButtonLink href={`${DOCUMIND_URL}/app/join`}>Join an organization in DocuMind</ButtonLink>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <>
      <header className="flex flex-col gap-1.5">
        <p className="text-sm text-muted-foreground">Welcome, {player.displayName}</p>
        <h1 className="font-heading text-[1.7rem] leading-tight font-semibold tracking-[-0.01em]">
          Your organizations
        </h1>
        <p className="text-sm text-muted-foreground">Each one has its own office, with a room for every department.</p>
      </header>
      <ul className="flex flex-col rounded-lg border">
        {orgs.map((org) => {
          const role = roleLabel(org, me.user.is_admin);
          return (
            <li key={org.id} className="flex items-center justify-between gap-4 border-b px-4 py-3 last:border-b-0">
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-[0.9375rem] font-medium">{org.name}</span>
                <span className="truncate font-mono text-[0.7rem] text-muted-foreground">{org.slug}</span>
              </span>
              {role && <span className="shrink-0 text-xs text-muted-foreground">{role}</span>}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function OrgListSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-label="Loading your organizations">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-64" />
      </div>
      <div className="flex flex-col gap-px overflow-hidden rounded-lg border">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="flex flex-col gap-1.5 px-4 py-3">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}
