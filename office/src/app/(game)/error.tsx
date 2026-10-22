"use client";

import { Button } from "@/components/ui/button";

export default function GameError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-start justify-center gap-4 px-4 py-16">
      <h1 className="font-heading text-2xl leading-tight font-semibold">The office couldn&apos;t open</h1>
      <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">
        DocuMind didn&apos;t answer in time, or something went wrong on our side. Try again in a moment.
      </p>
      {error.digest && <p className="font-mono text-xs text-muted-foreground">Ref {error.digest}</p>}
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
