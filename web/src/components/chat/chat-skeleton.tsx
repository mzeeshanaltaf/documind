import { Skeleton } from "@/components/ui/skeleton";

/** Stand-in for the chat workspace while the session, history and client bundle load. */
export function ChatSkeleton() {
  return (
    <div className="flex h-svh w-full" aria-busy="true" aria-label="Loading chat">
      <div className="hidden w-64 shrink-0 flex-col gap-2 border-r bg-sidebar/50 p-2 lg:flex">
        <Skeleton className="h-8 w-full" />
        <div className="flex flex-col gap-1.5 pt-4">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="h-12 shrink-0 border-b" />
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-3 px-4 pt-[8vh] md:px-6">
          <Skeleton className="h-7 w-72 max-w-full" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="mx-auto w-full max-w-3xl px-3 pb-5 md:px-6">
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
