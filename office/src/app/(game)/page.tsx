import { ArrowRightIcon, Building2Icon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ButtonLink } from "@/components/button-link";
import { DioramaBackdrop } from "@/components/home/diorama-backdrop";
import { OrgAvatar } from "@/components/home/org-avatar";
import { TopBar } from "@/components/home/top-bar";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { apiJson } from "@/lib/api";
import type { Me, Org } from "@/lib/api-types";
import { requireSession, withoutEvalOrgs } from "@/lib/auth-guards";
import { locationNameFromId } from "@/lib/locations";
import { DOCUMIND_URL } from "@/lib/site";
import { getPlayer } from "./actions";

/**
 * The org picker. With a single org it goes straight on to that org's globe, unless `?pick`
 * asks for the list (the globe's "Switch org", the logo).
 */
export default function HomePage({ searchParams }: PageProps<"/">) {
  return (
    <>
      <TopBar />
      <Suspense fallback={<HomeSkeleton />}>
        <Home searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const ROLE_LABELS: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member" };

function roleLabel(org: Org, isAdmin: boolean) {
  if (org.role) return ROLE_LABELS[org.role] ?? org.role;
  return isAdmin ? "Platform admin" : null;
}

async function Home({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  const { user } = await requireSession();
  // getPlayer() creates the player row on a first visit.
  const [me, player, params] = await Promise.all([apiJson<Me>("me", { userId: user.id }), getPlayer(), searchParams]);
  const orgs = await withoutEvalOrgs(me.orgs);

  if (orgs.length === 1 && params.pick === undefined) redirect(`/${orgs[0].slug}`);

  const lastOrg = orgs.find((org) => org.id === player.settings.last_org);
  const lastLocation = lastOrg && player.settings.last_location;
  const lastName = lastOrg && lastLocation ? locationNameFromId(lastOrg.slug, lastLocation) : null;

  return (
    <div className="grid flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
      <main className="flex w-full max-w-2xl flex-col gap-8 px-4 py-12 sm:px-10 lg:py-16">
        {orgs.length === 0 ? (
          <NoOrgs />
        ) : (
          <>
            <header className="flex flex-col gap-1.5">
              <p className="text-sm text-muted-foreground">Welcome, {player.displayName}</p>
              <h1 className="font-heading text-[1.7rem] leading-tight font-semibold tracking-[-0.01em]">
                Choose an organization
              </h1>
              <p className="text-sm text-muted-foreground">
                Each one has its own office, with a room for every department.
              </p>
            </header>

            {lastOrg && lastLocation && lastName && (
              <section
                aria-label="Last visit"
                className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-lg border bg-sidebar px-4 py-3"
              >
                <p className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">Last visit</span>
                  <span className="truncate text-sm font-medium">
                    {lastName} <span className="font-normal text-muted-foreground">· {lastOrg.name}</span>
                  </span>
                </p>
                <ButtonLink href={`/${lastOrg.slug}/${lastLocation}`}>
                  Resume in {lastName}
                  <ArrowRightIcon data-icon="inline-end" />
                </ButtonLink>
              </section>
            )}

            <ul aria-label="Your organizations" className="flex flex-col divide-y overflow-hidden rounded-lg border">
              {orgs.map((org) => {
                const role = roleLabel(org, me.user.is_admin);
                return (
                  <li key={org.id}>
                    <Link
                      href={`/${org.slug}`}
                      className="group flex items-center gap-3 px-4 py-3 transition-colors outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
                    >
                      <OrgAvatar name={org.name} logo={org.logo} className="size-9" />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-[0.9375rem] font-medium">{org.name}</span>
                        <span className="truncate font-mono text-[0.7rem] text-muted-foreground">{org.slug}</span>
                      </span>
                      {role && <span className="shrink-0 text-xs text-muted-foreground">{role}</span>}
                      <ChevronRightIcon
                        aria-hidden
                        className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5"
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>

            <p className="text-sm text-muted-foreground">
              Missing an organization?{" "}
              <a
                href={`${DOCUMIND_URL}/app/join`}
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                Join one in DocuMind
              </a>
            </p>
          </>
        )}
      </main>
      <aside aria-hidden className="relative hidden min-h-[28rem] border-l bg-sidebar lg:block">
        <div className="absolute inset-0">
          <DioramaBackdrop player={player} />
        </div>
      </aside>
    </div>
  );
}

function NoOrgs() {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Building2Icon />
        </EmptyMedia>
        <EmptyTitle className="font-heading text-xl">You&apos;re not in an organization yet</EmptyTitle>
        <EmptyDescription>
          The office opens for the organizations you belong to in DocuMind. Ask an admin to invite you, or request
          to join one.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <ButtonLink href={`${DOCUMIND_URL}/app/join`}>Join an organization in DocuMind</ButtonLink>
      </EmptyContent>
    </Empty>
  );
}

function HomeSkeleton() {
  return (
    <div className="grid flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
      <div
        className="flex w-full max-w-2xl flex-col gap-8 px-4 py-12 sm:px-10 lg:py-16"
        aria-busy="true"
        aria-label="Loading your organizations"
      >
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="flex flex-col divide-y rounded-lg border">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="size-9 rounded-md" />
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="hidden border-l bg-sidebar lg:block" />
    </div>
  );
}
