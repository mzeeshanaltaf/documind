import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { TopBar } from "@/components/home/top-bar";
import { LocationPicker } from "@/components/locations/location-picker";
import { Skeleton } from "@/components/ui/skeleton";
import { apiJson } from "@/lib/api";
import type { DocumentList } from "@/lib/api-types";
import { requireOrgAccessBySlug } from "@/lib/auth-guards";
import { countryName, deriveLocations } from "@/lib/locations";
import { getPlayer } from "../actions";

export const metadata: Metadata = { title: "Choose an office" };

/** The location picker: the org's offices on a globe and in a list (phase O3). */
export default function OrgPage({ params }: PageProps<"/[orgSlug]">) {
  return (
    <>
      <TopBar />
      <Suspense fallback={<PickerSkeleton />}>
        <Offices params={params} />
      </Suspense>
    </>
  );
}

async function Offices({ params }: Pick<PageProps<"/[orgSlug]">, "params">) {
  const { orgSlug } = await params;
  // Not a member (and not an admin), no such org, or an eval org: notFound().
  const { org, user } = await requireOrgAccessBySlug(orgSlug);
  const [{ documents }, player, renderedAt] = await Promise.all([
    apiJson<DocumentList>(`orgs/${org.id}/documents`, { userId: user.id }),
    getPlayer(),
    requestTime(),
  ]);
  const locations = deriveLocations(org, documents);
  const countries = Object.fromEntries(
    locations.flatMap((location) => (location.country ? [[location.country, countryName(location.country)]] : [])),
  );
  const resumeId =
    player.settings.last_org === org.id && locations.some((location) => location.id === player.settings.last_location)
      ? (player.settings.last_location ?? null)
      : null;

  return (
    <LocationPicker
      org={org}
      locations={locations}
      countries={countries}
      resumeId={resumeId}
      player={{ settings: player.settings, updatedAt: player.updatedAt }}
      renderedAt={renderedAt}
    />
  );
}

/** This request's clock, for the local times: the server and the first client render agree. */
async function requestTime() {
  await connection();
  return Date.now();
}

function PickerSkeleton() {
  return (
    <div
      className="grid flex-1 lg:h-[calc(100svh-4rem)] lg:grid-cols-[minmax(0,1fr)_25rem]"
      aria-busy="true"
      aria-label="Loading the offices"
    >
      <div className="flex h-[46svh] min-h-72 items-center justify-center lg:h-auto">
        <Skeleton className="aspect-square w-[min(70%,26rem)] rounded-full" />
      </div>
      <div className="flex flex-col gap-6 border-t bg-sidebar px-4 py-8 sm:px-10 lg:border-t-0 lg:border-l lg:px-7 lg:py-9">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-full" />
        </div>
        <div className="flex flex-col divide-y rounded-lg border bg-background">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex flex-col gap-1.5 px-4 py-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-44" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
