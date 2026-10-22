import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { GameBootScreen } from "@/components/game/game-boot-screen";
import { GameClient } from "@/components/game/game-client";
import { RecordVisit } from "@/components/game/record-visit";
import type { Spawn } from "@/game/store/game-store";
import { apiJson } from "@/lib/api";
import type { DocumentList, Me } from "@/lib/api-types";
import { requireOrgAccessBySlug } from "@/lib/auth-guards";
import { deriveLocations, LOCATION_ID } from "@/lib/locations";
import { getPlayer } from "../../actions";

export const metadata: Metadata = { title: "Office" };

/** On the placeholder's lawn, facing its sign. O4 replaces this with the city's own spawn. */
const CITY_SPAWN: Spawn = { position: [0, 0, 4], yaw: Math.PI };

/**
 * The world for one office location: access and the location are checked here, then the
 * client-only game takes over with the org, the location, the org's documents and the user.
 * Until O4 the city is a placeholder scene.
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
      <GameClient
        player={player}
        scene="city"
        spawn={CITY_SPAWN}
        location={{ org: org.name, city: place.name, room: null }}
        office={{ org: { id: org.id, name: org.name, slug: org.slug }, place, documents, me: me.user }}
      />
      <RecordVisit orgId={org.id} locationId={place.id} />
    </>
  );
}
