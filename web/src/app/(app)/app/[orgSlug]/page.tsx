import { redirect } from "next/navigation";
import { Suspense } from "react";

export default function OrgIndexPage({ params }: PageProps<"/app/[orgSlug]">) {
  return (
    <Suspense>
      <RedirectToChat params={params} />
    </Suspense>
  );
}

async function RedirectToChat({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  return redirect(`/app/${orgSlug}/chat`);
}
