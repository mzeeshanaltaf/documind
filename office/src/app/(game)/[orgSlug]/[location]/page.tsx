import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { GameBootScreen } from "@/components/game/game-boot-screen";
import { GameClient } from "@/components/game/game-client";
import { RecordVisit } from "@/components/game/record-visit";
import { apiJson } from "@/lib/api";
import type { DocumentList, Me } from "@/lib/api-types";
import { requireOrgAccessBySlug } from "@/lib/auth-guards";
import { cityEntrySpawn } from "@/game/world/city/spawns";
import { deriveLocations, LOCATION_ID } from "@/lib/locations";
import { getPlayer } from "../../actions";

export const metadata: Metadata = { title: "Office" };

/**
 * The world for one office location: access and the location are checked here, then the
 * client-only game takes over with the org, the location, the org's documents and the user,
 * starting on the city's plaza (or the Global Hub's) facing the office doors.
 */
export default function LocationPage({ params }: PageProps<"/[orgSlug]/[location]">) {
  return (
    <Suspense fallback={<GameBootScreen />}>
      <World params={params} />
    </Suspense>
  );
}

async function World({ params }: Pick<PageProps<"/[orgSlug]/[location]">, "params">) {
  const { orgSlug, location: locationId } = await params;
  const { org, user } = await requireOrgAccessBySlug(orgSlug);
  if (!LOCATION_ID.test(locationId)) notFound();

  const [{ documents }, me, player] = await Promise.all([
    apiJson<DocumentList>(`orgs/${org.id}/documents`, { userId: user.id }),
    apiJson<Me>("me", { userId: user.id }),
    getPlayer(),
  ]);
  const place = deriveLocations(org, documents).find((location) => location.id === locationId);
  if (!place) notFound();

  return (
    <>
      {/* Keyed by place: travelling from the hub to a city starts a fresh game. */}
      <GameClient
        key={place.id}
        player={player}
        scene="city"
        spawn={cityEntrySpawn(place)}
        location={{ org: org.name, city: place.name, room: null }}
        office={{ org: { id: org.id, name: org.name, slug: org.slug }, place, documents, me: me.user }}
      />
      <RecordVisit orgId={org.id} locationId={place.id} />
    </>
  );
}
