"use client";

import { RouteError } from "@/components/app/route-error";

// Wraps every org page (chat, documents, members, settings, analytics) inside the org shell.
export default function OrgError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError {...props} />;
}
