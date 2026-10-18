"use client";

import { ArrowRightIcon, CheckIcon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FormAlert } from "@/components/auth/form-alert";
import { OrgAvatar } from "@/components/app/org-avatar";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { joinOrganization } from "./actions";

type Item = { id: string; name: string; slug: string };

export function JoinOrgList({ available, joined }: { available: Item[]; joined: Item[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [justJoined, setJustJoined] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // The server refresh also returns freshly joined orgs in `joined`, so dedupe by id.
  const mine = [...new Map([...joined, ...justJoined].map((o) => [o.id, o])).values()];
  const joinedIds = new Set(mine.map((o) => o.id));
  const open = available.filter((o) => !joinedIds.has(o.id));

  function join(org: Item) {
    setError(null);
    setPendingId(org.id);
    startTransition(async () => {
      const result = await joinOrganization(org.id);
      setPendingId(null);
      if (result.ok) setJustJoined((prev) => [...prev, org]);
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <FormAlert message={error} />
      {open.length > 0 ? (
        <ul className="flex flex-col divide-y rounded-lg border bg-card">
          {open.map((org) => (
            <li key={org.id} className="flex items-center gap-3 p-3 sm:p-4">
              <OrgAvatar name={org.name} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{org.name}</span>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => join(org)}>
                {pendingId === org.id ? <Spinner data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}
                Join
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {mine.length > 0 ? "You've joined every available organization." : "No organizations are available yet."}
        </p>
      )}
      {mine.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Joined</h2>
          <ul className="flex flex-col divide-y rounded-lg border bg-card">
            {mine.map((org) => (
              <li key={org.id} className="flex items-center gap-3 p-3 sm:p-4">
                <OrgAvatar name={org.name} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{org.name}</span>
                <CheckIcon className="size-4 text-muted-foreground" aria-hidden />
                <Button size="sm" onClick={() => router.push(`/app/${org.slug}/chat`)}>
                  Open
                  <ArrowRightIcon data-icon="inline-end" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
